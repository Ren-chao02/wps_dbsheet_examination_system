/**
 * 考试系统压测脚本（k6）
 *
 * 目标：回答一个至今没有答案的问题 —— 「几千个学生同时用，这套系统撑得住吗？」
 *
 * 最危险的不是稳态，而是**开考瞬间**：几百上千人在几分钟内同时点「开始作答」，
 * 每一击都要为该考生生成一份卷子快照（StudentExamQuestion 批量落库），
 * 之后才是每 30 秒一次的心跳与每次改答案的自动保存。
 *
 * 用法见同目录 README.md。核心参数：
 *   k6 run tests/load/exam-load.js \
 *     -e BASE_URL=http://localhost:3002 \
 *     -e EXAM_ID=<考试UUID> \
 *     -e STUDENT_FROM=20250001 \
 *     -e PASSWORD=<学生初始密码> \
 *     -e SCENARIO=opening -e VUS=200
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import encoding from 'k6/encoding';
import { Trend, Rate } from 'k6/metrics';
import exec from 'k6/execution';

// ───────── 参数 ─────────
const BASE = __ENV.BASE_URL || 'http://localhost:3002';
const EXAM_ID = __ENV.EXAM_ID || '';
const PASSWORD = __ENV.PASSWORD || '';
const STUDENT_FROM = Number(__ENV.STUDENT_FROM || 20250001);
const VUS = Number(__ENV.VUS || 50);
const SCENARIO = __ENV.SCENARIO || 'opening';
const THINK_SECONDS = Number(__ENV.THINK_SECONDS || 3);

/**
 * 只做参数校验，不产生任何负载。
 * 放在 setup() 而不是模块顶层：顶层抛错会让 `k6 inspect` 这类只做静态检查的
 * 命令也一并失败，而 inspect 恰恰是改脚本时最常用的自检手段。
 */
export function setup() {
  if (!EXAM_ID || !PASSWORD) {
    // 提前失败，避免跑出一堆登录 401 后才发现参数没给
    throw new Error('必须通过 -e EXAM_ID=<考试UUID> -e PASSWORD=<学生密码> 指定参数');
  }
  return { checkedAt: new Date().toISOString() };
}

// ───────── 自定义指标 ─────────
// 分开计时是为了能一眼看出「慢在哪一段」：登录慢是 DB/密码哈希，
// 开考慢是卷子快照落库，自动保存慢是写库热点。
const loginTrend = new Trend('stage_login', true);
const startTrend = new Trend('stage_start_exam', true);
const paperTrend = new Trend('stage_fetch_paper', true);
const saveTrend = new Trend('stage_autosave', true);
const beatTrend = new Trend('stage_heartbeat', true);
const submitTrend = new Trend('stage_submit', true);
const businessFailure = new Rate('business_failure');

export const options = {
  scenarios: {
    // 开考瞬间：VU 数 = 同时在线的学生数，每人只跑一轮完整流程（登录→开考→答题→交卷）
    opening: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '10m',
      exec: 'examFlow',
      tags: { scenario: 'opening' },
    },
    // 稳态：已开考学生的心跳 + 自动保存，持续压
    steady: {
      executor: 'constant-vus',
      vus: VUS,
      duration: __ENV.DURATION || '3m',
      exec: 'steadyFlow',
      tags: { scenario: 'steady' },
    },
  },
  thresholds: {
    // 这两个阈值是**待校准**的起点，不是结论。先用小规模跑一次拿到基线，
    // 再按实际硬件把数字收紧——否则阈值只会变成一句谁都不看的口号。
    http_req_failed: ['rate<0.01'],
    'stage_start_exam': ['p(95)<2000'],
    'stage_autosave': ['p(95)<500'],
    'stage_heartbeat': ['p(95)<300'],
  },
  // 压测机自己也可能成为瓶颈，关掉不必要的开销
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ───────── 工具 ─────────

/** 把 k6 的全局迭代序号映射到一个唯一学号，保证每个"学生"只出现一次 */
function studentUsername() {
  return String(STUDENT_FROM + exec.scenario.iterationInTest);
}

/**
 * 取验证码并解出答案。
 *
 * 这里能成立，是因为服务端把答案明文放进了 JWT payload（只签名、未加密），
 * base64 解一下就能拿到 —— 也就是说这个验证码**挡不住脚本化登录**。
 * 对压测来说这是好事：不用为测试在生产代码里开后门，直接走真实登录链路。
 * （该问题已单独记录，建议把答案改为服务端存储或 HMAC 校验。）
 */
function fetchCaptcha() {
  const res = http.get(`${BASE}/api/auth/captcha`);
  if (res.status !== 200) return null;
  const body = res.json();
  if (!body || !body.captchaToken) return null;
  const payload = JSON.parse(encoding.b64decode(body.captchaToken.split('.')[1], 'rawurl', 's'));
  return { token: body.captchaToken, answer: String(payload.answer) };
}

function login(username) {
  const started = Date.now();
  const captcha = fetchCaptcha();
  if (!captcha) {
    businessFailure.add(true, { stage: 'captcha' });
    return null;
  }

  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({
      username,
      password: PASSWORD,
      captchaToken: captcha.token,
      captchaText: captcha.answer,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  loginTrend.add(Date.now() - started);

  const ok = check(res, { '登录成功': (r) => r.status === 200 });
  if (!ok) {
    businessFailure.add(true, { stage: 'login' });
    return null;
  }
  const body = res.json();
  const token = body.token || body.data?.token;
  if (!token) {
    businessFailure.add(true, { stage: 'login-no-token' });
    return null;
  }
  return token;
}

const authHeaders = (token) => ({
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
});

/** 开考：这是整个流程里最重的一击（生成该考生的卷子快照并落库） */
function startExam(token) {
  const started = Date.now();
  const res = http.post(`${BASE}/api/my-exams/${EXAM_ID}/start-wps`, null, authHeaders(token));
  startTrend.add(Date.now() - started);
  const ok = check(res, { '开考成功': (r) => r.status === 200 });
  if (!ok) businessFailure.add(true, { stage: 'start' });
  return ok;
}

/** 取本卷题目（抽题组卷下每人题目不同，必须用服务端下发的题目 ID 作答） */
function fetchPaper(token) {
  const started = Date.now();
  const res = http.get(`${BASE}/api/my-exams/${EXAM_ID}`, authHeaders(token));
  paperTrend.add(Date.now() - started);
  if (!check(res, { '取卷成功': (r) => r.status === 200 })) {
    businessFailure.add(true, { stage: 'paper' });
    return [];
  }
  const body = res.json();
  const questions = body.questions || (body.data && body.data.questions) || [];
  return questions;
}

/** 自动保存：学生每改一次答案就触发一次（客户端 800ms 防抖后串行发送） */
function autosave(token, questions) {
  if (!questions.length) return;
  // 只挑客观题作答：实操题的"答案"是对 WPS 表格的操作，脚本无法模拟
  const objective = questions.filter((q) => Array.isArray(q.options) && q.options.length > 0);
  if (!objective.length) return;

  const payload = {
    answers: objective.map((q) => ({
      questionId: q.id,
      answer: q.type === 'multiple_choice' ? [q.options[0].key] : q.options[0].key,
    })),
  };
  const started = Date.now();
  const res = http.put(
    `${BASE}/api/my-exams/${EXAM_ID}/answers`,
    JSON.stringify(payload),
    authHeaders(token)
  );
  saveTrend.add(Date.now() - started);
  if (!check(res, { '自动保存成功': (r) => r.status === 200 })) {
    businessFailure.add(true, { stage: 'autosave' });
  }
}

function heartbeat(token) {
  const started = Date.now();
  const res = http.post(
    `${BASE}/api/my-exams/${EXAM_ID}/heartbeat`,
    JSON.stringify({ currentQuestion: 0 }),
    authHeaders(token)
  );
  beatTrend.add(Date.now() - started);
  if (!check(res, { '心跳成功': (r) => r.status === 200 })) {
    businessFailure.add(true, { stage: 'heartbeat' });
  }
}

function submit(token) {
  const started = Date.now();
  const res = http.post(`${BASE}/api/my-exams/${EXAM_ID}/submit`, null, authHeaders(token));
  submitTrend.add(Date.now() - started);
  if (!check(res, { '交卷成功': (r) => r.status === 200 })) {
    businessFailure.add(true, { stage: 'submit' });
  }
}

// ───────── 场景实现 ─────────

/** 开考瞬间：一人一次完整流程 */
export function examFlow() {
  const username = studentUsername();
  const token = login(username);
  if (!token) return;

  if (!startExam(token)) return;

  let questions = [];
  group('取卷', () => { questions = fetchPaper(token); });

  // 模拟答题过程中每隔几秒保存一次
  for (let i = 0; i < 5; i++) {
    autosave(token, questions);
    sleep(THINK_SECONDS);
  }

  // 结尾留一个 VU 不交卷，避免把"大批学生同时交卷"和"开考"两个热点叠在一起——
  // 想单独压交卷，用 SCENARIO=steady 后再集中调用 submit。
  if (exec.scenario.iterationInTest % 10 !== 0) {
    submit(token);
  }
}

/** 稳态：已开考学生的心跳与自动保存 */
export function steadyFlow() {
  const username = studentUsername();
  const token = login(username);
  if (!token) return;

  const questions = fetchPaper(token);
  // 心跳 30 秒一次、自动保存按学生实际作答频率（这里取每 10 秒一次）
  const iterations = Math.ceil((Number(__ENV.DURATION_SECONDS || 180)) / 10);
  for (let i = 0; i < iterations; i++) {
    heartbeat(token);
    if (i % 3 === 0) autosave(token, questions);
    sleep(10);
  }
}
