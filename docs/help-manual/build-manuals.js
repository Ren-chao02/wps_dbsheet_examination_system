/* 生成三份角色操作手册（管理员 / 教师 / 学生） */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber,
} = require('docx');

const FONT = 'Microsoft YaHei';
const PRIMARY = '1F4E79';
const ACCENT = '2E75B6';
const CONTENT_W = 9026; // A4，左右各 1 英寸
const OUT_DIR = '/data/wps_dbsheet_examination_system/docs/help-manual';

function parseRuns(text, base = {}) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return new TextRun({ font: FONT, size: 21, color: '333333', ...base, text: part.slice(2, -2), bold: true });
    }
    return new TextRun({ font: FONT, size: 21, color: '333333', ...base, text: part });
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    children: parseRuns(text, opts.run),
    spacing: { line: 340, after: 100, ...(opts.spacing || {}) },
    alignment: opts.alignment,
    pageBreakBefore: opts.pageBreakBefore,
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    children: [new TextRun({ text, font: FONT, size: 34, bold: true, color: PRIMARY })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, font: FONT, size: 26, bold: true, color: PRIMARY })],
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, font: FONT, size: 23, bold: true, color: '404040' })],
  });
}

function bullets(items, ref) {
  return items.map((item) => new Paragraph({
    numbering: { reference: ref, level: 0 },
    children: parseRuns(item),
    spacing: { line: 320, after: 60 },
  }));
}

let stepCounter = 0;
function steps(items) {
  stepCounter += 1;
  const ref = `steps-${stepCounter}`;
  const paras = items.map((item) => new Paragraph({
    numbering: { reference: ref, level: 0 },
    children: parseRuns(item),
    spacing: { line: 320, after: 60 },
  }));
  paras.__numRef = ref;
  return paras;
}

function table(headers, rows, widths) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      borders,
      width: { size: widths[i], type: WidthType.DXA },
      shading: { fill: 'D9E2F3', type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ children: [new TextRun({ text: h, font: FONT, size: 20, bold: true, color: PRIMARY })] })],
    })),
  });
  const bodyRows = rows.map((row) => new TableRow({
    children: row.map((cell, i) => new TableCell({
      borders,
      width: { size: widths[i], type: WidthType.DXA },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: parseRuns(cell, { size: 20 }), spacing: { line: 300, after: 0 } })],
    })),
  }));
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: [headerRow, ...bodyRows],
  });
}

function note(text) {
  const b = { style: BorderStyle.SINGLE, size: 1, color: 'F0C36D' };
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: CONTENT_W, type: WidthType.DXA },
        shading: { fill: 'FFF7E6', type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        borders: { top: b, bottom: b, left: b, right: b },
        children: [new Paragraph({
          children: [
            new TextRun({ text: '提示  ', font: FONT, size: 20, bold: true, color: 'B26A00' }),
            ...parseRuns(text, { size: 20 }),
          ],
          spacing: { line: 300, after: 0 },
        })],
      })],
    })],
  });
}

function spacer(after = 100) {
  return new Paragraph({ children: [], spacing: { after } });
}

function cover(title, subtitle, role) {
  return [
    new Paragraph({
      spacing: { before: 2600, after: 160 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title, font: FONT, size: 56, bold: true, color: PRIMARY })],
    }),
    new Paragraph({
      spacing: { after: 240 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: subtitle, font: FONT, size: 28, color: '666666' })],
    }),
    new Paragraph({
      spacing: { after: 1200 },
      alignment: AlignmentType.CENTER,
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 10 } },
      children: [new TextRun({ text: '', font: FONT, size: 2 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: '陕西师范大学 · 多维表格实操考试系统', font: FONT, size: 24, color: '555555' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: `适用角色：${role}`, font: FONT, size: 22, color: '555555' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: '版本：V1.0     发布日期：2026-11-03', font: FONT, size: 22, color: '555555' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '内部资料 · 请勿外传', font: FONT, size: 20, color: '999999' })],
    }),
  ];
}

function toc(entries) {
  const out = [
    new Paragraph({
      pageBreakBefore: true,
      spacing: { before: 200, after: 240 },
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '目  录', font: FONT, size: 36, bold: true, color: PRIMARY })],
    }),
  ];
  entries.forEach((entry, i) => {
    out.push(new Paragraph({
      spacing: { after: 120, line: 320 },
      children: [
        new TextRun({ text: `${String(i + 1).padStart(2, '0')}   ${entry}`, font: FONT, size: 22, color: '333333' }),
      ],
    }));
  });
  return out;
}

const BLOCK_MAP = {
  h1, h2, h3, para, bullets, steps, table, note, spacer,
};

function renderBlocks(blocks) {
  const children = [];
  const numberingConfigs = [];
  const bulletRef = 'bullets-main';
  numberingConfigs.push({
    reference: bulletRef,
    levels: [{
      level: 0,
      format: LevelFormat.BULLET,
      text: '•',
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } },
    }],
  });

  for (const block of blocks) {
    if (block.type === 'h1') children.push(h1(block.text));
    else if (block.type === 'h2') children.push(h2(block.text));
    else if (block.type === 'h3') children.push(h3(block.text));
    else if (block.type === 'p') children.push(para(block.text));
    else if (block.type === 'bullets') {
      children.push(...bullets(block.items, bulletRef));
    } else if (block.type === 'steps') {
      const paras = steps(block.items);
      children.push(...paras);
      numberingConfigs.push({
        reference: paras.__numRef,
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      });
    } else if (block.type === 'table') {
      children.push(table(block.headers, block.rows, block.widths));
      children.push(spacer(160));
    } else if (block.type === 'note') {
      children.push(note(block.text));
      children.push(spacer(120));
    } else if (block.type === 'spacer') {
      children.push(spacer(block.after || 100));
    }
  }
  return { children, numberingConfigs };
}

function buildDoc(meta, blocks) {
  const coverChildren = cover(meta.title, meta.subtitle, meta.role);
  const tocChildren = toc(meta.toc);
  const { children, numberingConfigs } = renderBlocks(blocks);

  const doc = new Document({
    creator: '多维表格实操考试系统',
    title: meta.title,
    description: meta.subtitle,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 21, color: '333333' },
          paragraph: { spacing: { line: 340, after: 100 } },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 34, bold: true, color: PRIMARY, font: FONT },
          paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, color: PRIMARY, font: FONT },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 23, bold: true, color: '404040', font: FONT },
          paragraph: { spacing: { before: 180, after: 90 }, outlineLevel: 2 },
        },
      ],
    },
    numbering: { config: numberingConfigs },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            tabStops: [{ type: 'right', position: CONTENT_W }],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9', space: 4 } },
            children: [
              new TextRun({ text: meta.title, font: FONT, size: 18, color: '888888' }),
              new TextRun({ text: '\t多维表格实操考试系统', font: FONT, size: 18, color: '888888' }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: '第 ', font: FONT, size: 18, color: '888888' }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: '888888' }),
              new TextRun({ text: ' 页', font: FONT, size: 18, color: '888888' }),
            ],
          })],
        }),
      },
      children: [...coverChildren, ...tocChildren, ...children],
    }],
  });

  return doc;
}

/* ============================================================
 * 学生手册
 * ============================================================ */
const studentBlocks = [
  { type: 'h1', text: '1  手册说明' },
  { type: 'p', text: '本手册面向参加**多维表格实操考试**的学生，说明如何登录系统、参加考试、提交试卷、查询成绩以及使用题库练习。' },
  { type: 'bullets', items: [
    '**适用对象**：在本系统参加考试或练习的在校学生。',
    '**使用环境**：建议使用最新版 Chrome 或 Edge 浏览器，屏幕分辨率不低于 1280×720。',
    '**手册版本**：V1.0（2026-11-03）。系统功能更新后，以实际页面为准。',
  ] },
  { type: 'note', text: '考试过程中如遇页面异常、无法进入考试等问题，请立即举手联系监考教师，不要自行反复刷新或关闭浏览器。' },

  { type: 'h1', text: '2  登录系统' },
  { type: 'p', text: '系统按身份区分登录入口，学生请选择「学生」身份登录。' },
  { type: 'steps', items: [
    '打开系统地址，进入登录页。',
    '在「选择登录身份」中选择**学生**。',
    '输入**学号**、**密码**和**验证码**。',
    '如为个人电脑，可勾选「7 天内免登录」；公用电脑请勿勾选。',
    '点击「登录」进入系统。',
  ] },
  { type: 'bullets', items: [
    '同一账号连续登录失败 **10 次**将锁定 **15 分钟**，请确认学号与密码后再提交。',
    '忘记密码请联系任课教师或系统管理员重置。重置后系统会生成一次性随机口令，请及时修改为自己的密码。',
    '密码被重置或自行修改后，之前在其他设备上的登录会立即失效。',
  ] },
  { type: 'note', text: '如果学校开通了 WPS 账号登录，登录页会显示 WPS 登录入口；未开通时请使用学号 + 密码登录。' },

  { type: 'h1', text: '3  个人信息与密码' },
  { type: 'p', text: '登录后，点击右上角头像，选择「个人信息」，可以查看和维护自己的账号信息。' },
  { type: 'bullets', items: [
    '**身份信息**：姓名、学号、班级、院系、专业、账号状态、上次登录时间、WPS 绑定状态。',
    '**密码修改**：填写原密码、新密码（至少 8 位）和确认新密码，点击「保存新密码」。',
  ] },
  { type: 'p', text: '密码修改成功后系统会自动退出登录，请使用**新密码**重新登录。' },
  { type: 'note', text: '姓名、学号、班级等信息来自学校名册，页面只读。如信息有误，请联系任课教师或管理员更正。' },

  { type: 'h1', text: '4  首页与我的考试' },
  { type: 'p', text: '登录后的首页展示待完成的考试和个人数据概览。' },
  { type: 'bullets', items: [
    '**待完成的考试**：显示即将开始、正在进行或待入场的考试，可直接进入。',
    '**我的数据**：我的考试、练习次数、已出成绩、收藏题目。',
    '**我的考试**：按时间列出考试名称、批次、考试时间、考场和状态。',
  ] },
  { type: 'p', text: '考试按钮会根据当前状态显示「未开始」「进入考试」「继续答题」或「已交卷」。超过最晚入场时间后，将无法再进入考试。' },

  { type: 'h1', text: '5  进入考试' },
  { type: 'p', text: '正式作答前需要完成环境检测和考前确认，全部通过后才能进入答题界面。' },
  { type: 'steps', items: [
    '在首页或「我的考试」中点击「进入考试」。',
    '按页面提示完成**环境检测**：全屏状态、浏览器兼容性、屏幕分辨率与硬件、网络连接。',
    '核对考生信息（姓名、学号、班级、考试名称）。',
    '阅读考场规则，勾选同意后点击「开始作答」。',
  ] },
  { type: 'bullets', items: [
    '环境检测未通过时，按页面提示处理（如恢复全屏、更换浏览器、检查网络）后重新检测。',
    '进入考试前请关闭无关程序，保持浏览器全屏。',
    '迟到和入场时间以考试设置为准；超过最晚入场时间将无法进入。',
  ] },
  { type: 'note', text: '进入作答后如果误关浏览器，重新登录并从「继续答题」进入即可，已经保存的答案不会丢失。' },

  { type: 'h1', text: '6  答题界面' },
  { type: 'p', text: '答题界面左侧是题目与答题卡。客观题不显示表格；做实操题时，右侧会出现本次考试的 WPS 多维表格。' },
  { type: 'h2', text: '6.1  客观题' },
  { type: 'bullets', items: [
    '单选题、多选题、判断题直接点击选项作答，选择后自动保存。',
    '单选题和判断题只能选择一个选项；多选题可以选择多个。',
    '可通过答题卡查看已答/未答题目并快速跳转。',
  ] },
  { type: 'h2', text: '6.2  实操题' },
  { type: 'p', text: '实操题要求你在右侧真实的 WPS 多维表格中完成操作，系统在交卷后读取表格的实际结构进行判分。' },
  { type: 'bullets', items: [
    '按题目要求完成建表、添加字段、配置视图、创建表单等操作。',
    '务必在题目指定的表格中操作，不要随意修改与题目无关的表名或字段名。',
    '如果看不到题目要求的表格，可能是题目要求你先创建它，按题目说明操作即可。',
  ] },
  { type: 'h2', text: '6.3  表格显示方式' },
  { type: 'bullets', items: [
    '**只有实操题会在右侧显示表格**，客观题自动收起，不占用答题空间。',
    '客观题需要查看表格时，可点顶部「查看表格」打开独立窗口；窗口已打开时按钮变为「回到表格窗口」。',
    '实操题的表格默认以**内嵌**方式显示；如无法加载或需要更大操作空间，可切换到「独立窗口」工作台。',
    '独立窗口查看表格期间不会被计为切屏；返回答题页面后可继续作答。',
  ] },
  { type: 'h2', text: '6.4  倒计时与考试纪律' },
  { type: 'bullets', items: [
    '剩余时间以考试**结束时间**为准，到点系统会自动收卷。',
    '切换标签页、切换窗口等行为会被记录为切屏，请保持在全屏考试页面内。',
    '退出全屏后页面会提示恢复，请按提示返回全屏状态。',
    '网络短暂中断时页面会提示重试，恢复后继续作答即可。',
  ] },

  { type: 'h1', text: '7  交卷' },
  { type: 'steps', items: [
    '完成答题后点击「交卷」。',
    '在确认弹窗中核对未答题数量。',
    '确认提交后，试卷状态变为「已交卷」，答案不能再修改。',
  ] },
  { type: 'note', text: '考试结束时间到达时系统会自动收卷。若交卷时提示网络异常，请等待页面重试或联系监考教师，不要重复点击提交。' },

  { type: 'h1', text: '8  成绩查询' },
  { type: 'p', text: '通过顶部或左侧导航进入「成绩查询」，可查看已出分的考试。' },
  { type: 'bullets', items: [
    '列表显示考试名称、得分、及格线、通过/未通过、提交时间、评分时间。',
    '刚交卷时成绩可能处于「评分中」状态，需要教师完成自动阅卷后才会出分。',
    '实操题中的部分判定可能需要教师人工复核，复核完成后成绩才是最终结果。',
  ] },

  { type: 'h1', text: '9  题库练习' },
  { type: 'p', text: '题库练习用于熟悉多维表格操作，不影响正式考试成绩。' },
  { type: 'bullets', items: [
    '在「题库练习」中按分类、难度、题型筛选题目，点击「开始」进入练习。',
    '练习可以中断：下次进入时会提示「继续上次」，之前的进度会保留。',
    '**场景实战**会按顺序给出一条完整的任务链，中途退出后表格内容与进度仍会保留。',
    '练习判分后会显示判分明细和解析，帮助你理解每一步的对错。',
    '被判分规则标记为「待复核」的题目，表示系统无法完全自动判定，以教师复核结果为准。',
  ] },
  { type: 'note', text: '练习需要教师为你配置练习表格。如果提示「未配置练习表格」，请联系任课教师配置后再开始练习。' },

  { type: 'h1', text: '10  我的题集' },
  { type: 'p', text: '「我的题集」集中展示你收藏的题目和做错过的题目。' },
  { type: 'bullets', items: [
    '可按分类、难度查看题目，并直接点击「开练」重新练习。',
    '列表会显示错题次数，便于定位薄弱知识点。',
    '练习中做错的题目会自动加入题集，无需手动收藏。',
  ] },

  { type: 'h1', text: '11  加入班级' },
  { type: 'p', text: '学生账号通过教师发送的班级邀请开通或归入班级。' },
  { type: 'steps', items: [
    '打开教师发送的邀请链接，或在登录页输入邀请码。',
    '填写学号、真实姓名、性别和手机号。',
    '提交申请，等待教师审批。',
    '审批通过后，账号会归入对应班级，并收到通知。',
  ] },
  { type: 'bullets', items: [
    '学号只能包含字母和数字。',
    '邀请链接有有效期，失效后请向教师重新索取。',
    '申请被拒绝时会显示教师填写的原因，可按原因修正后重新申请。',
  ] },

  { type: 'h1', text: '12  通知中心' },
  { type: 'p', text: '右上角铃铛图标用于接收系统通知，包括考试安排、审批结果等。有未读通知时图标上会显示红点，点击即可查看。' },

  { type: 'h1', text: '13  常见问题' },
  { type: 'table',
    headers: ['问题', '处理方法'],
    widths: [3000, 6026],
    rows: [
      ['验证码看不清或提示错误', '点击验证码图片刷新；仍失败可稍后再试。'],
      ['账号被锁定', '连续 10 次登录失败会锁定 15 分钟；等待自动解锁，或联系管理员解除。'],
      ['忘记密码', '联系任课教师或管理员重置；拿到随机口令后尽快在「个人信息」中修改。'],
      ['WPS 表格打不开或跳到登录页', '切换到「独立窗口」再试；仍不行请联系监考教师检查表格分享权限。'],
      ['退出全屏后提示异常', '按页面提示点击恢复全屏，不要继续在非全屏状态下答题。'],
      ['交卷后一直显示评分中', '需要教师触发自动阅卷；请耐心等待或联系教师。'],
      ['刷新页面后担心答案丢失', '客观题选择已自动保存；实操题以 WPS 表格中的实际内容为准，重新进入继续作答即可。'],
      ['无法进入考试', '检查是否在考试时间窗内、是否超过最晚入场时间、是否已经交卷。'],
      ['练习时提示未配置表格', '联系任课教师为你配置练习表格。'],
    ] },
];

/* ============================================================
 * 教师手册
 * ============================================================ */
const teacherBlocks = [
  { type: 'h1', text: '1  手册说明' },
  { type: 'p', text: '本手册面向使用系统组织教学与考试的**教师**，覆盖题库、组卷、考务、阅卷成绩和学生管理。' },
  { type: 'bullets', items: [
    '管理员账号拥有教师端全部功能，本手册同样适用。',
    '教师的数据范围以任教班级和本人创建的考试为主：学生列表只显示自己任教班级的学生。',
    '系统功能更新后，以实际页面为准。',
  ] },
  { type: 'h1', text: '2  登录与个人信息' },
  { type: 'steps', items: [
    '打开系统地址，在登录页选择**教师**身份。',
    '输入**工号**、密码和验证码，点击「登录」。',
    '个人电脑可勾选「7 天内免登录」，公用电脑请勿勾选。',
  ] },
  { type: 'bullets', items: [
    '教师登录名由工号决定，不能自行修改。',
    '连续登录失败 10 次将锁定 15 分钟。',
    '点击右上角头像 →「个人信息」，可查看工号、院系、账号状态、上次登录和 WPS 绑定状态，并修改密码（至少 8 位，修改后需重新登录）。',
  ] },
  { type: 'h1', text: '3  工作台' },
  { type: 'p', text: '登录后的工作台提供系统概览和常用入口。顶部导航按业务域划分：工作台、题库与试卷、考务管理、阅卷管理、学生管理、缓存管理等；左侧为当前模块的子功能。' },
  { type: 'h1', text: '4  题库管理' },
  { type: 'h2', text: '4.1  查看与筛选题目' },
  { type: 'bullets', items: [
    '支持按关键词、分类/知识点、难度（简单/中等/困难）、状态（已启用/已禁用）、来源（官方题库/校本题库）和场景筛选。',
    '点击「重置筛选」可清空全部条件。',
    '题目列表可查看题干、题型、分类、难度、分值和创建人。',
  ] },
  { type: 'h2', text: '4.2  题型说明' },
  { type: 'p', text: '系统支持两类题型：' },
  { type: 'bullets', items: [
    '**实操题（5 种）**：创建数据表、添加字段、配置视图、创建表单、综合实操。学生在真实 WPS 表格中操作，系统读取表格结构判分。',
    '**客观题（3 种）**：单选题、多选题、判断题。学生在页面中选择选项，按预设答案判分。',
  ] },
  { type: 'h2', text: '4.3  新建实操题' },
  { type: 'steps', items: [
    '进入「题库管理」，点击「新建题目」。',
    '选择题型（如创建数据表、添加字段等），填写题干、分类、难度和分值。',
    '在「判分规则」中添加规则并设置每条规则的分数。规则决定系统读取表格后如何比对。',
    '按需配置能力图谱、前置契约和场景链，便于抽题与练习编排。',
    '保存并启用题目。',
  ] },
  { type: 'p', text: '判分时系统会读取学生表格的**实际结构**逐条比对。无法从表格结构完整判定的规则会被标记为「待复核」，交由教师人工确认，不要为了自动化而放宽规则。' },
  { type: 'h2', text: '4.4  出题辅助' },
  { type: 'bullets', items: [
    '**三段式辅助**：选择能力点 → 导入标准答案 → 预览反向解析出的判分规则。',
    '**AI 辅助出题**：在题目编辑器中打开 AI 面板，根据能力点生成题目骨架和建议；使用前需在「AI 模型配置」中配置模型。',
    '生成或导入的规则务必人工核对后再启用。',
  ] },
  { type: 'h2', text: '4.5  新建客观题' },
  { type: 'steps', items: [
    '新建题目时选择题型为单选题、多选题或判断题。',
    '填写题干和选项；判断题系统会预填「正确/错误」。',
    '勾选正确选项：单选题和判断题只能勾选 1 个，多选题至少勾选 1 个。',
    '保存并启用。',
  ] },
  { type: 'h2', text: '4.6  维护题目' },
  { type: 'bullets', items: [
    '可编辑、启用/禁用或删除题目。',
    '禁用后的题目不会进入新的组卷，但已生成的试卷快照不受影响。',
  ] },
  { type: 'h1', text: '5  试卷库与组卷' },
  { type: 'p', text: '试卷按**题位**组织。题位可以是固定题目，也可以是一条抽题规则；开考时系统会按照题位为每名学生生成一份试卷快照。' },
  { type: 'h2', text: '5.1  新建试卷' },
  { type: 'steps', items: [
    '进入「试卷库」，点击「创建试卷」。',
    '填写试卷名称、总分和及格分。',
    '添加**固定题**，或点击「新增抽题规则」按题型、难度、知识点和数量配置抽题。',
    '检查每个题位的候选题目数量；候选只有 1 道时系统会提示，避免「每生不同」退化为全员同题。',
    '保存试卷。',
  ] },
  { type: 'h2', text: '5.2  组卷规则与注意事项' },
  { type: 'bullets', items: [
    '**每生一份卷**：开考时按题位为学生生成卷子并落库保存，历史答卷始终对应当时的题目。',
    '**等值替换**：同一题位的候选必须满足同知识点、同难度、同题型、同分值，且引用相同的表格和字段。',
    '**表格引用是硬约束**：题目要求操作哪张表、哪些字段，变体题就必须引用同样的表和字段，否则学生打开表格找不到操作对象。',
    '建议组卷后查看试卷分析，确认总分、题量和抽题候选是否充足。',
    '试卷的复制与删除仅限本人创建的试卷；官方试卷可以复制，但不能删除。',
  ] },
  { type: 'note', text: '如果某条抽题规则的候选题目长期不足，请补充同知识点、同难度、同分值的题目，或减少该规则的抽题数量。' },
  { type: 'h1', text: '6  考务管理' },
  { type: 'h2', text: '6.1  批次管理' },
  { type: 'p', text: '批次用于统一配置一次考试活动的公共参数，批次内的考试共享这些设置。' },
  { type: 'steps', items: [
    '进入「考务管理 → 批次管理」，创建批次。',
    '设置候考时长、迟到容忍、冻结时间等参数。',
    '点击「发布/上线批次」；上线后系统会自动发布批次下已准备好的考试，学生才能看到。',
  ] },
  { type: 'h2', text: '6.2  考试管理' },
  { type: 'steps', items: [
    '进入「考务管理 → 考试管理」，点击「创建考试」。',
    '按向导完成 5 个步骤：选择批次 → 绑定试卷 → 考场监考设置 → 考生设置 → WPS 表格分配。',
    '填写考试名称、考试时间、考试模式等信息。',
    '发布考试；发布后学生才能在考试列表中看到。',
  ] },
  { type: 'bullets', items: [
    '教师默认只能查看和管理**本人创建**的考试。',
    'WPS 表格分配会校验分享链接是否可读；不可读的链接会被拒绝保存，避免学生入场后看不到表格。',
    '需要提前结束时，可使用「强制结束」；已结束的考试不能再修改配置。',
  ] },
  { type: 'h2', text: '6.3  考场管理' },
  { type: 'p', text: '教师可查看考场、监考教师和学生分配情况。新建、编辑、删除考场和批量导入考场仅**校级管理员**可操作，教师端不会显示这些按钮。' },
  { type: 'h2', text: '6.4  实时监控中心' },
  { type: 'steps', items: [
    '进入「考务管理 → 实时监控中心」，选择考试进入监控详情。',
    '查看应参考、到考、缺考、答题中、已交卷等人数与状态。',
    '点开学生可查看当前题目和答题进度。',
    '关注异常预警：心跳超时离线、窗口失焦、复制粘贴次数超限等。',
    '必要时可开始考试、结束考试或导出监控数据。',
  ] },
  { type: 'h1', text: '7  阅卷与成绩' },
  { type: 'h2', text: '7.1  自动阅卷' },
  { type: 'p', text: '**交卷不会自动判分**，需要教师主动触发自动阅卷。' },
  { type: 'steps', items: [
    '进入「阅卷管理 → 自动阅卷」，选择考试。',
    '对单份答卷点击「自动阅卷」，或点击「批量自动阅卷」处理该考试所有待批改答卷。',
    '确认后系统读取学生 WPS 表格并逐条比对判分。',
    '在答卷统计中查看已交卷、评分中、已评分数量。',
  ] },
  { type: 'h2', text: '7.2  人工复核与手动评分' },
  { type: 'steps', items: [
    '打开一份答卷，查看每道题的判分明细（规则、期望结果、实际结果、得分）。',
    '对标记为「待复核」的规则项进行人工确认；必要时手动调整分数。',
    '点击「保存评分」，全部确认后点击「完成评分」。',
    '如学生修改过表格或需要重新判定，可点击「重新判分」。',
  ] },
  { type: 'note', text: '「待复核」不是系统故障，而是某些操作无法从表格结构可靠判定（例如视图筛选条件）。请按题目要求人工核对后再给分。' },
  { type: 'h2', text: '7.3  成绩统计分析' },
  { type: 'bullets', items: [
    '查看分数段分布、及格率、平均分、题目得分率等指标。',
    '查看风险标记（考场异常、高危行为次数、提交时间等）。',
    '导出分析报告；从成绩分析的学生列表可进入学生能力画像。',
  ] },
  { type: 'h2', text: '7.4  数据导出中心' },
  { type: 'bullets', items: [
    '选择导出内容（成绩记录、行为日志等）和导出格式。',
    '提交后可在任务列表查看进度并下载文件。',
    '导出范围限于本人的考试与任教班级数据。',
  ] },
  { type: 'h1', text: '8  学生管理' },
  { type: 'p', text: '教师只能查看和操作**本人任教班级**的学生。' },
  { type: 'h2', text: '8.1  班级管理' },
  { type: 'bullets', items: [
    '教师端班级管理为只读：可查看任教班级、人数和班级编码。',
    '班级编码用于学生批量导入时匹配班级，点击编码可复制。',
  ] },
  { type: 'h2', text: '8.2  学生列表' },
  { type: 'steps', items: [
    '进入「学生管理 → 学生列表」，可按院系、专业、班级或关键词筛选。',
    '点击「新增学生」创建学生账号（学号即登录名）。',
    '可编辑学生信息、禁用/启用账号、重置密码、删除学生。',
    '点击「练习表格」可为单个学生配置练习用的 WPS 表格。',
  ] },
  { type: 'bullets', items: [
    '重置密码会生成一次性随机口令，只在弹窗中显示一次，请当场转告学生。',
    '重置密码后，该学生之前的登录会立即失效。',
    '导出的学生名单包含班级编码，可用于核对或重新导入。',
  ] },
  { type: 'h2', text: '8.3  批量导入学生' },
  { type: 'steps', items: [
    '进入「学生管理 → 学生列表」，点击「批量导入」。',
    '下载导入模板，按模板填写：学号、姓名、性别、手机号、邮箱、班级编码。',
    '上传填好的 .xlsx 文件（不超过 5MB）。',
    '系统逐行校验并显示失败行与原因；可下载失败记录，修正后重新上传。',
    '在「导入导出任务」中查看导入进度。',
  ] },
  { type: 'note', text: '班级编码是必填项且必须真实存在；学生只能导入到自己任教的班级，否则该行会被拒绝。' },
  { type: 'h2', text: '8.4  邀请管理' },
  { type: 'steps', items: [
    '进入「学生管理 → 邀请管理」，点击「创建邀请链接」。',
    '选择关联班级，设置有效期（0 表示不限）。',
    '复制邀请链接或邀请码发送给学生。',
    '链接失效或不再使用时，可点击「禁用邀请」。',
  ] },
  { type: 'h2', text: '8.5  审批队列' },
  { type: 'steps', items: [
    '进入「学生管理 → 审批队列」，查看学生提交的入班申请。',
    '核对学号、姓名和申请班级后，点击通过或拒绝。',
    '拒绝时必须填写原因，系统会通知学生。',
    '可勾选多条申请批量通过。',
  ] },
  { type: 'h1', text: '9  WPS Token 与 AI 模型配置' },
  { type: 'bullets', items: [
    '**WPS Token 管理**：查看当前 access_token 的剩余有效期；如提示即将过期或已失效，可手动刷新。Token 失效会导致表格读取和判分失败。',
    '**AI 模型配置**：填写大模型 API Key 和模型参数，供 AI 辅助出题使用。未配置时 AI 辅助功能不可用。',
  ] },
  { type: 'h1', text: '10  常见问题' },
  { type: 'table',
    headers: ['问题', '处理方法'],
    widths: [3200, 5826],
    rows: [
      ['分配 WPS 表格时提示「表格不可读」', '检查文档分享权限和链接是否失效；确认链接是完整的分享链接后重新粘贴。'],
      ['学生打不开表格或跳到登录页', '建议学生切换到「独立窗口」；仍不行时检查表格分享权限。'],
      ['判分提示「找不到表」', '学生可能重命名或删除了题目指定的表；核对题目要求的表名与字段名，必要时人工复核。'],
      ['答卷一直停留在「已交卷」', '尚未触发自动阅卷，或表格已失效导致读取失败；先执行自动阅卷并查看错误原因。'],
      ['抽题规则候选不足', '补充同知识点、同难度、同分值的题目，或减少该规则的抽题数量。'],
      ['「待复核」项很多', '部分操作无法从接口完整读取（如视图筛选条件），需要人工核对；不要为了减少复核而放宽判分规则。'],
      ['学生重置密码后无法登录', '确认转告的是最新一次生成的随机口令（只显示一次）；必要时重新重置。'],
      ['WPS 相关操作全部失败', '检查 WPS Token 是否有效；在「WPS Token 管理」中刷新后重试。'],
    ] },
];

/* ============================================================
 * 管理员手册
 * ============================================================ */
const adminBlocks = [
  { type: 'h1', text: '1  手册说明' },
  { type: 'p', text: '本手册面向**校级管理员**，覆盖账户、班级、院系、角色权限和系统配置。管理员账号同时拥有教师端全部功能。' },
  { type: 'bullets', items: [
    '管理员使用独立系统账号登录，不使用工号或学号。',
    '系统管理属于校级操作，涉及全校账号与组织数据，请谨慎授权。',
    '系统功能更新后，以实际页面为准。',
  ] },
  { type: 'h1', text: '2  登录与个人信息' },
  { type: 'steps', items: [
    '打开系统地址，在登录页选择**管理员**身份。',
    '输入系统账号（登录名）、密码和验证码，点击「登录」。',
  ] },
  { type: 'bullets', items: [
    '管理员账号不是工号/学号，登录名由创建账户时指定。',
    '连续登录失败 10 次将锁定 15 分钟。',
    '点击右上角头像 →「个人信息」，可查看账号信息并修改密码；修改后需重新登录。',
  ] },
  { type: 'h1', text: '3  系统管理总览' },
  { type: 'p', text: '登录后进入「系统管理」模块，左侧包含以下功能：' },
  { type: 'bullets', items: [
    '**账户管理**：创建、编辑、禁用账户，重置密码，解除锁定与 WPS 绑定。',
    '**班级管理**：建班、改班、删除班级、批量分配教师。',
    '**角色权限管理**：定义系统角色及可访问的模块。',
    '**导入导出任务**：查看批量导入任务进度与历史。',
    '**缓存管理**：查看和清理系统缓存。',
    '**AI 模型配置**：配置 AI 辅助出题使用的模型。',
  ] },
  { type: 'p', text: '顶部导航中的题库与试卷、考务管理、阅卷管理、学生管理属于教师端功能，管理员同样可以使用。' },
  { type: 'h1', text: '4  账户管理' },
  { type: 'h2', text: '4.1  新增账户' },
  { type: 'steps', items: [
    '进入「系统管理 → 账户管理」，点击「新增账户」。',
    '选择角色：管理员、教师或学生。',
    '管理员：填写系统登录名和密码；教师：填写工号（工号即登录名）和密码；学生：填写学号（学号即登录名）和密码。',
    '填写姓名、邮箱等可选信息，保存。',
  ] },
  { type: 'p', text: '系统全局校验学号、工号和登录名的唯一性，发生冲突时会提示具体原因。' },
  { type: 'h2', text: '4.2  维护账户' },
  { type: 'bullets', items: [
    '**编辑**：修改姓名、邮箱、角色等信息。',
    '**禁用/启用**：禁用后账号立即无法登录，已登录的请求也会被拒绝。',
    '**重置密码**：生成一次性随机口令，只在弹窗中显示一次；重置后该账号之前的登录立即失效。',
    '**解除 WPS 绑定**：学生或教师换绑 WPS 账号时使用，解绑后下次登录会重新走绑定流程。',
    '**解除登录锁定**：账号因连续失败被锁定 15 分钟时，可手动解除。',
    '**导出**：导出账户列表用于核对或存档。',
  ] },
  { type: 'h2', text: '4.3  批量导入账户' },
  { type: 'p', text: '账户导入模板共 7 列：' },
  { type: 'table',
    headers: ['列', '内容', '说明'],
    widths: [900, 2600, 5526],
    rows: [
      ['1', '系统登录名', '管理员必填；教师可留空或与工号一致。'],
      ['2', '密码', '必填，长度不少于 6 位。'],
      ['3', '姓名', '选填。'],
      ['4', '邮箱', '选填，填写时需符合邮箱格式。'],
      ['5', '角色编码', 'TEACHER 或 ADMIN；留空默认 TEACHER。'],
      ['6', '院系编码', '选填；填写时必须能匹配到已存在的院系。'],
      ['7', '工号', '教师必填，且作为教师登录名；管理员不填。'],
    ] },
  { type: 'note', text: '学生账号不在账户导入模板中创建，请使用「学生管理 → 批量导入学生」。导入时某一行失败只会跳过该行，其余行继续导入，失败原因可在任务中查看和下载。' },
  { type: 'h1', text: '5  班级管理' },
  { type: 'p', text: '班级是学生归属和教师任教关系的主实体。班主任/任课教师由管理员在班级中分配。' },
  { type: 'h2', text: '5.1  新建与编辑班级' },
  { type: 'steps', items: [
    '进入「系统管理 → 班级管理」，点击「新建班级」。',
    '填写班级名称、学年、年级；班级编码可留空，系统会自动生成。',
    '按需选择院系和专业（可选），并选择任教教师。',
    '保存。之后可编辑、批量删除班级，或点击「管理教师」批量分配/替换教师。',
  ] },
  { type: 'bullets', items: [
    '班级编码唯一，是学生批量导入时的匹配键；点击编码可复制。',
    '可使用「从 WPS 通讯录快速建班」按组织架构批量创建班级。',
    '教师端只能查看自己任教的班级，写操作仅管理员可用。',
  ] },
  { type: 'h1', text: '6  院系与专业' },
  { type: 'p', text: '院系/专业作为班级的可选元数据保留，从班级管理页进入维护。' },
  { type: 'bullets', items: [
    '维护院系、专业的名称和编码，供账户导入、学生导入和班级归属使用。',
    '删除院系时，已归属该院系的班级不会被删除，只是院系归属被置空。',
  ] },
  { type: 'h1', text: '7  角色权限管理' },
  { type: 'steps', items: [
    '进入「系统管理 → 角色权限管理」，新建或编辑角色。',
    '填写角色编码、角色名称和备注。',
    '勾选该角色可访问的系统模块。',
    '保存；不再使用的角色可禁用。',
  ] },
  { type: 'note', text: '角色和权限以数据库实时值为准，调整后无需用户重新登录即可生效。' },
  { type: 'h1', text: '8  导入导出任务与缓存' },
  { type: 'bullets', items: [
    '**导入导出任务**：查看批量导入的进度、成功/失败行数和失败原因，并下载失败记录。',
    '**缓存管理**：查看缓存键、大小和存活时间，可刷新或清理系统缓存。清理缓存不会删除业务数据。',
  ] },
  { type: 'h1', text: '9  AI 模型配置' },
  { type: 'p', text: '在「AI 模型配置」中填写大模型 API Key、模型名称等参数，供教师端 AI 辅助出题使用。修改后建议让教师重新打开 AI 面板验证是否生效。' },
  { type: 'h1', text: '10  管理员与教师端的关系' },
  { type: 'p', text: '管理员账号拥有教师端的全部能力（题库、组卷、考务、阅卷、统计、学生管理）。与教师相比，管理员额外拥有以下权限：' },
  { type: 'bullets', items: [
    '新建、编辑、删除考场，批量导入考场。',
    '新建、编辑、删除班级，批量分配教师。',
    '创建系统账户，重置任意账户密码，解除登录锁定和 WPS 绑定。',
    '维护角色权限、院系专业和系统缓存。',
  ] },
  { type: 'h1', text: '11  安全与审计' },
  { type: 'bullets', items: [
    '账号连续登录失败 10 次锁定 15 分钟；管理员可在账户管理中解除。',
    '重置密码使用一次性随机口令，只在重置时显示一次，请通过可靠渠道转告本人。',
    '重置密码或用户自行改密后，该账号此前签发的登录凭证立即失效。',
    '系统自动记录增删改操作（操作人、时间、变更数据），审计日志仅校级管理员可查询。',
    '生产环境升级后需要执行数据库迁移；建议定期备份数据库和上传文件。',
  ] },
  { type: 'h1', text: '12  常见问题' },
  { type: 'table',
    headers: ['问题', '处理方法'],
    widths: [3200, 5826],
    rows: [
      ['教师无法新建考场或班级', '这是权限设计：考场与班级的写操作仅校级管理员可用；教师端只查看。'],
      ['教师看不到某些学生', '教师的数据范围是本人任教班级；确认该学生已归入其任教班级。'],
      ['新增账户提示学号/工号冲突', '学号、工号和登录名全局唯一，请先查询是否已存在。'],
      ['学生账号如何创建', '通过「学生管理 → 新增学生」或批量导入学生创建，不在账户导入模板中创建。'],
      ['管理员忘记密码', '由其他管理员在账户管理中重置；如无其他管理员，请联系系统技术人员。'],
      ['WPS 绑定异常或需要换绑', '在账户管理中解除 WPS 绑定，让用户重新走绑定流程。'],
      ['批量导入一直处理中', '在导入导出任务中查看状态；若长时间无进展，检查后端队列与日志。'],
      ['修改角色权限后未生效', '权限按数据库实时值判定；让用户刷新页面或重新进入模块即可。'],
    ] },
];

const docs = [
  {
    file: '学生操作手册.docx',
    title: '学生操作手册',
    subtitle: '多维表格实操考试系统',
    role: '学生',
    toc: ['手册说明', '登录系统', '个人信息与密码', '首页与我的考试', '进入考试', '答题界面', '交卷', '成绩查询', '题库练习', '我的题集', '加入班级', '通知中心', '常见问题'],
    blocks: studentBlocks,
  },
  {
    file: '教师操作手册.docx',
    title: '教师操作手册',
    subtitle: '多维表格实操考试系统',
    role: '教师',
    toc: ['手册说明', '登录与个人信息', '工作台', '题库管理', '试卷库与组卷', '考务管理', '阅卷与成绩', '学生管理', 'WPS Token 与 AI 模型配置', '常见问题'],
    blocks: teacherBlocks,
  },
  {
    file: '管理员操作手册.docx',
    title: '管理员操作手册',
    subtitle: '多维表格实操考试系统',
    role: '管理员',
    toc: ['手册说明', '登录与个人信息', '系统管理总览', '账户管理', '班级管理', '院系与专业', '角色权限管理', '导入导出任务与缓存', 'AI 模型配置', '管理员与教师端的关系', '安全与审计', '常见问题'],
    blocks: adminBlocks,
  },
];

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const item of docs) {
    stepCounter = 0;
    const doc = buildDoc(item, item.blocks);
    const buffer = await Packer.toBuffer(doc);
    const outPath = path.join(OUT_DIR, item.file);
    fs.writeFileSync(outPath, buffer);
    console.log(`generated: ${outPath} (${buffer.length} bytes)`);
  }
})();
