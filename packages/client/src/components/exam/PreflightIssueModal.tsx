import { Modal, Tag } from 'antd';

export interface PreflightIssue {
  slotIndex: number;
  reason: string;
  candidates: number;
  signatureConflict: boolean;
}

/**
 * 发布/重试被组卷预检阻断时（HTTP 400 + preflight[]），把逐题位缺口展开给教师，
 * 否则只能看到一句"N 个题位没有可用题目"，不知道去改哪个题位。
 * 返回 false 表示不是预检错误，调用方走原来的 message.error。
 */
export function showPreflightError(err: any): boolean {
  const data = err?.response?.data;
  const issues = data?.preflight as PreflightIssue[] | undefined;
  if (!Array.isArray(issues) || issues.length === 0) return false;
  Modal.error({
    title: data?.message || '组卷预检未通过',
    width: 560,
    content: (
      <div>
        <p style={{ marginTop: 8 }}>以下题位没有可用题目，请到试卷编辑页调整题位规则或补充题库后再发布：</p>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          {issues.map((it, i) => (
            <li key={`${it.slotIndex}-${i}`} style={{ marginBottom: 6 }}>
              题位 {it.slotIndex + 1}：{it.reason}
              {it.candidates > 0 ? `（可用候选 ${it.candidates} 道）` : ''}
              {it.signatureConflict && <Tag color="red" style={{ marginLeft: 6 }}>结构签名冲突</Tag>}
            </li>
          ))}
        </ul>
      </div>
    ),
  });
  return true;
}
