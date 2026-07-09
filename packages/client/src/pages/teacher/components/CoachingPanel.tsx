/**
 * CoachingPanel — Phase 2 §5.1 AI 对话式教练侧栏
 *
 * 形态：AntD Drawer（右侧 ~480px），浮动按钮触发。
 * 流程：输入 → coachingApi.chat（SSE 流式）→ 逐 delta 追加文字 → proposals 挂在 AI 消息下。
 *
 * 内部状态：
 *   messages[] — 文字消息（user/assistant）
 *   proposalsByMsg — Map<msgId, {proposal, status}[]>
 *   streaming / abortController — 流式控制
 *
 * @see docs/superpowers/specs/2026-07-08-phase2-ai-coaching-design.md §5.1/§5.5
 */
import { useState, useRef, useCallback } from 'react';
import {
  Drawer, Button, Input, Space, Typography, Alert, Spin, FloatButton,
} from 'antd';
import {
  RobotOutlined, SendOutlined, StopOutlined, MessageOutlined,
} from '@ant-design/icons';
import { coachingApi } from '../../../services/coachingApi';
import { ProposalCard, type ProposalStatus } from './ProposalCard';
import type { Proposal, CoachingMessage, QuestionState } from '../../../types';

const { Text, Paragraph } = Typography;

interface CoachingPanelProps {
  /** 每轮发送前从表单现场拼装的题目状态 */
  questionState: QuestionState;
  /** WPS 凭据（有则能 grounding add_rule，无则降级） */
  credentials?: { fileId: string; accessToken: string; apiSecret?: string };
  /** 应用建议卡（QuestionEditor 持有，含 React state setters） */
  onApplyProposal: (p: Proposal) => { ok: boolean; reason?: string };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface ProposalEntry {
  proposal: Proposal;
  status: ProposalStatus;
}

/** 空态建议提问 */
const SUGGESTED_PROMPTS = [
  '看看这题还能怎么完善',
  '帮我补一个单选字段考点',
  '描述写得更地道点',
];

let msgIdCounter = 0;
const nextMsgId = () => `msg-${++msgIdCounter}`;

export function CoachingPanel({ questionState, credentials, onApplyProposal }: CoachingPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposalsByMsg, setProposalsByMsg] = useState<Record<string, ProposalEntry[]>>({});
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasStandardAnswer = !!(credentials?.fileId && credentials?.accessToken);

  /** 发送一轮对话 */
  const handleSend = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || streaming) return;

    setError(null);
    setInput('');

    // 追加用户消息 + 占位 AI 消息
    const userMsg: ChatMessage = { id: nextMsgId(), role: 'user', text: content };
    const aiMsg: ChatMessage = { id: nextMsgId(), role: 'assistant', text: '' };
    const history: CoachingMessage[] = [
      ...messages.map(m => ({ role: m.role, content: m.text })),
      { role: 'user' as const, content },
    ];
    setMessages(prev => [...prev, userMsg, aiMsg]);

    // 流式接收
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await coachingApi.chat(
        {
          questionState,
          history,
          fileId: credentials?.fileId,
          accessToken: credentials?.accessToken,
          apiSecret: credentials?.apiSecret,
        },
        {
          onDelta: (delta) => {
            setMessages(prev =>
              prev.map(m =>
                m.id === aiMsg.id ? { ...m, text: m.text + delta } : m,
              ),
            );
          },
          onProposals: (proposals) => {
            if (proposals.length > 0) {
              setProposalsByMsg(prev => ({
                ...prev,
                [aiMsg.id]: proposals.map(p => ({ proposal: p, status: 'pending' as ProposalStatus })),
              }));
            }
          },
          onError: (msg) => {
            setError(msg);
          },
          signal: controller.signal,
        },
      );
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'AI 对话失败');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, messages, questionState, credentials]);

  /** 停止流式 */
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** 应用建议卡 */
  const handleApply = useCallback((msgId: string, idx: number, proposal: Proposal) => {
    const result = onApplyProposal(proposal);
    if (result.ok) {
      setProposalsByMsg(prev => ({
        ...prev,
        [msgId]: prev[msgId].map((e, i) =>
          i === idx ? { ...e, status: 'applied' } : e,
        ),
      }));
    } else {
      setError(result.reason || '应用失败');
    }
  }, [onApplyProposal]);

  /** 忽略建议卡 */
  const handleDismiss = useCallback((msgId: string, idx: number) => {
    setProposalsByMsg(prev => ({
      ...prev,
      [msgId]: prev[msgId].map((e, i) =>
        i === idx ? { ...e, status: 'dismissed' } : e,
      ),
    }));
  }, []);

  return (
    <>
      <FloatButton
        icon={<RobotOutlined />}
        type="primary"
        tooltip="AI 教练"
        onClick={() => setOpen(true)}
        style={{ right: 24, bottom: 80 }}
      />

      <Drawer
        title={
          <Space>
            <RobotOutlined />
            <span>AI 教练</span>
          </Space>
        }
        placement="right"
        width={480}
        open={open}
        onClose={() => setOpen(false)}
        styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
      >
        {/* 无标准答案警告 */}
        {open && !hasStandardAnswer && (
          <Alert
            type="warning"
            showIcon
            message="未导入标准答案，AI 看不到你的表，规则类建议不可用"
            style={{ borderRadius: 0 }}
          />
        )}

        {/* 错误提示 */}
        {error && (
          <Alert
            type="error"
            showIcon
            message={error}
            closable
            onClose={() => setError(null)}
            style={{ borderRadius: 0 }}
          />
        )}

        {/* 消息列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', paddingTop: 48 }}>
              <MessageOutlined style={{ fontSize: 32, color: '#bbb' }} />
              <Paragraph type="secondary" style={{ marginTop: 12 }}>
                和 AI 教练聊聊，打磨你的题目
              </Paragraph>
              <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>
                {SUGGESTED_PROMPTS.map(prompt => (
                  <Button
                    key={prompt}
                    block
                    onClick={() => handleSend(prompt)}
                    style={{ textAlign: 'left' }}
                  >
                    {prompt}
                  </Button>
                ))}
              </Space>
            </div>
          ) : (
            messages.map(msg => (
              <div
                key={msg.id}
                style={{
                  marginBottom: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: msg.role === 'user' ? '#1677ff' : '#f0f0f0',
                    color: msg.role === 'user' ? '#fff' : '#333',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.text || (streaming && msg.role === 'assistant' ? (
                    <Spin size="small" />
                  ) : '')}
                </div>
                {/* 建议卡列表（挂在 AI 消息下） */}
                {proposalsByMsg[msg.id]?.map((entry, idx) => (
                  <div key={idx} style={{ maxWidth: '85%', marginTop: 8, width: '100%' }}>
                    <ProposalCard
                      proposal={entry.proposal}
                      status={entry.status}
                      onApply={() => handleApply(msg.id, idx, entry.proposal)}
                      onDismiss={() => handleDismiss(msg.id, idx)}
                    />
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* 输入区 */}
        <div style={{ padding: 12, borderTop: '1px solid #f0f0f0' }}>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="输入消息..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onPressEnter={() => handleSend()}
              disabled={streaming}
            />
            {streaming ? (
              <Button
                danger
                icon={<StopOutlined />}
                onClick={handleStop}
              >
                停止
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => handleSend()}
                disabled={!input.trim()}
              >
                发送
              </Button>
            )}
          </Space.Compact>
        </div>
      </Drawer>
    </>
  );
}
