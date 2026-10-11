# 压测（k6）

回答一个至今没有答案的问题：**几千个学生同时用，这套系统撑得住吗？**

最危险的不是稳态，而是**开考瞬间**——几百上千人在几分钟内同时点「开始作答」，
每一击都要为该考生生成一份卷子快照（`StudentExamQuestion` 批量落库）。
卷子生成是写库最重的路径，而它恰好发生在所有人同时按下的那一刻。

## 安装 k6

```bash
# 下载对应平台的二进制，放进 PATH 即可（无需 root）
# https://github.com/grafana/k6/releases
curl -sSL https://github.com/grafana/k6/releases/download/v2.3.0/k6-v2.3.0-linux-amd64.tar.gz \
  | tar -xz --strip-components=1 -C ~/.local/bin k6-v2.3.0-linux-amd64/k6
```

## 跑之前要准备什么

1. **一场可开考的考试**：`status` 为 `published` 或 `in_progress`，批次为 `active`。
2. **一批连续学号的学生账号**：脚本按 `<STUDENT_FROM> + 迭代序号` 推算用户名（用户名即学号），
   所以需要一个连续号段。这些学生的密码必须相同。
3. **人数 ≤ 学号段长度**：VU 数超过号段长度会有两个 VU 撞同一个学号。

> ⚠️ 压测会**真实产生答卷数据**（开考记录、作答、交卷）。请务必用独立的测试考试，
> 不要拿正式考试的 ID 跑。

## 两种场景

### 开考瞬间（最该先跑的一个）

```bash
k6 run tests/load/exam-load.js \
  -e BASE_URL=http://localhost:3002 \
  -e EXAM_ID=<考试UUID> \
  -e STUDENT_FROM=20250001 \
  -e PASSWORD=<学生密码> \
  -e SCENARIO=opening -e VUS=200
```

每个 VU 走一遍完整流程：登录 → 开考 → 取卷 → 五次自动保存 → 交卷。
`VUS=200` 就是「200 人同时开考」。

**建议从 50 起步，逐步翻倍**：50 → 100 → 200 → 400 …
每一档记录 `stage_start_exam` 的 p95 与 `http_req_failed`，找到它开始劣化的拐点，
那个拐点就是当前配置的真实容量。

### 稳态（心跳 + 自动保存）

```bash
k6 run tests/load/exam-load.js \
  -e BASE_URL=http://localhost:3002 -e EXAM_ID=<考试UUID> \
  -e STUDENT_FROM=20250001 -e PASSWORD=<学生密码> \
  -e SCENARIO=steady -e VUS=500 -e DURATION=3m
```

模拟已开考学生的 30 秒心跳与周期自动保存。教室里的真实负载是
「开考瞬间 + 长时间稳态」的叠加，两者要分开测，才能知道该扩容哪一段。

## 看什么指标

| 指标 | 含义 | 为什么关心它 |
| --- | --- | --- |
| `stage_login` | 登录耗时 | 含 bcrypt 校验，是 CPU 密集段；几千人同时登录会排队 |
| `stage_start_exam` | 开考耗时 | 含卷子快照批量落库，**开考瞬间的瓶颈通常在这里** |
| `stage_autosave` | 自动保存耗时 | 学生每改一次答案就触发，最容易变成写库热点 |
| `stage_heartbeat` | 心跳耗时 | 频率最高（3000 人 × 每 30 秒 = 100 次/秒） |
| `business_failure` | 业务失败率 | 区分「HTTP 通了但业务失败」，比 `http_req_failed` 更贴近真实 |

`thresholds` 里那几个数字是**待校准的起点，不是结论**。先小规模跑一次拿基线，
再按你的实际硬件把阈值收紧。

## 一个已知的前置问题

登录接口强制要求验证码，但**答案是以明文放在 JWT payload 里的**（只签名、未加密），
任何脚本都能 base64 解出来。所以：

- 压测**不需要**在生产代码里开后门，直接走真实登录链路（脚本已实现）；
- 但这也意味着这个验证码**挡不住脚本化登录**，只是一道心理门槛。
  要真正生效，应把答案存到服务端（Redis / 数据库）或改成 HMAC 校验，
  而不是塞进一个客户端持有的 token。
