import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Empty, Modal, Spin, Tag, Tooltip, message } from 'antd';
import { ArrowLeftOutlined, EditOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { DIFFICULTY_LABELS, buildDocGroups, docEntryDifficulty, type DocEntry } from '../../utils/paperAssembly';
import { questionTypeLabel, toChineseIndex } from '../../utils/questionLabels';
import type { Capability, Paper } from '../../types';

/**
 * 试卷详情页（版式对齐参考产品 WPS 教学平台的「试卷详情」）
 *
 * 卷面文档（居中白卡）+ 右侧「试卷结构」吸顶栏；鼠标悬停题目 → 题目卡片浮现边框、
 * 底部信息条淡入（难度 ｜ 分值 N 分 ｜ 查看详情），信息条常驻占位不引起版面跳动。
 *
 * 与参考产品的差异：我们的试卷允许「固定题 + 抽题规则」混排。抽题题位在卷面上渲染为
 * 虚线占位卡（开考时才由 paper-generator 抽成具体题目），试卷结构栏里用虚线框题号标识，
 * 两种题位都用连续题号（与开考后的答题卡口径一致）。
 */

// ── 页面 ────────────────────────────────────────────────────────

export function PaperDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [loading, setLoading] = useState(true);
  const [capabilityNames, setCapabilityNames] = useState<Map<string, string>>(new Map());
  const [activeEntry, setActiveEntry] = useState<DocEntry | null>(null);
  /** 从试卷结构跳转后短暂高亮的题号：点击后没有任何视觉反馈会被当成"点了没反应" */
  const [flashIndex, setFlashIndex] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/papers/${id}`)
      .then(res => setPaper(res.data))
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    // 知识点名：规则与题目里的能力点 id 要有中文名才读得懂；接口拿不到就退回显示 id，不阻塞整页
    api.get('/capabilities')
      .then(res => {
        const list: Capability[] = res.data?.data?.capabilities || [];
        setCapabilityNames(new Map(list.map(c => [c.id, c.name])));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (flashIndex == null) return;
    const timer = setTimeout(() => setFlashIndex(null), 1600);
    return () => clearTimeout(timer);
  }, [flashIndex]);

  const groups = useMemo(() => buildDocGroups(paper?.paperQuestions || []), [paper]);
  const totalSlots = groups.reduce((sum, g) => sum + g.entries.length, 0);

  const capNames = (ids?: string[] | null): string[] =>
    (ids || []).map(capId => capabilityNames.get(capId) || capId);

  const gotoEntry = (index: number) => {
    document.getElementById(`paper-slot-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFlashIndex(index);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (!paper) return <div style={{ textAlign: 'center', padding: 100 }}><Empty description="试卷不存在或已被删除" /></div>;

  const isOwner = currentUser?.role === 'admin' || paper.createdBy === currentUser?.id;

  return (
    <div className="page-container" style={{ maxWidth: 1200 }}>
      <div className="paper-doc-topbar">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/teacher/papers')} />
        <h2>试卷详情</h2>
        {paper.source === 'official' && <Tag color="orange">官方</Tag>}
        <span style={{ flex: 1 }} />
        {isOwner && (
          <Button icon={<EditOutlined />} onClick={() => navigate(`/teacher/papers/${paper.id}/edit`)}>
            编辑试卷
          </Button>
        )}
      </div>

      <div className="paper-doc">
        {/* ── 卷面文档 ── */}
        <div className="paper-doc__page">
          <div className="paper-doc__head">
            <h1 className="paper-doc__name">{paper.name}</h1>
            <div className="paper-doc__meta">
              <span>总分：{paper.totalScore}</span>
              <span>题数：{totalSlots}</span>
              <span>及格分：{paper.passScore ?? '—'}</span>
            </div>
            {paper.description && <div className="paper-doc__remark">备注：{paper.description}</div>}
          </div>

          {totalSlots === 0 ? (
            <Empty description="这份试卷还没有题目" style={{ padding: '48px 0' }}>
              {isOwner && (
                <Button type="primary" onClick={() => navigate(`/teacher/papers/${paper.id}/edit`)}>去组卷</Button>
              )}
            </Empty>
          ) : (
            groups.map((group, gi) => (
              <section key={group.key} className="paper-doc__group">
                <h3 className="paper-doc__group-title">{toChineseIndex(gi + 1)}、{group.label}</h3>
                {group.entries.map(entry => (
                  <div
                    key={entry.slotId}
                    id={`paper-slot-${entry.index}`}
                    className={`paper-doc__item${flashIndex === entry.index ? ' paper-doc__item--flash' : ''}`}
                  >
                    <div className="paper-doc__content">
                      {entry.kind === 'fixed'
                        ? <FixedContent entry={entry} capNames={capNames} />
                        : <RuleContent entry={entry} capNames={capNames} />}
                    </div>
                    <div className="paper-doc__footer">
                      <div className="paper-doc__stats">
                        <DifficultyLabel entry={entry} />
                        <i className="paper-doc__stats-divider" />
                        <span>分值 {entry.score} 分</span>
                      </div>
                      <button type="button" className="paper-doc__link" onClick={() => setActiveEntry(entry)}>
                        查看详情
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>

        {/* ── 试卷结构 ── */}
        <aside className="paper-doc__structure">
          <div className="paper-doc__structure-head">
            <h3>试卷结构</h3>
            <Tooltip title="按题型分组显示题号，点击题号可跳转到对应题目；虚线框为开考时自动抽题的题位">
              <QuestionCircleOutlined className="paper-doc__structure-help" />
            </Tooltip>
          </div>
          {totalSlots === 0 ? (
            <p className="paper-doc__structure-empty">暂无题目</p>
          ) : (
            groups.map(group => (
              <section key={group.key} className="paper-doc__structure-section">
                <div className="paper-doc__structure-title">
                  <span>{group.label}</span>
                  <em>（共 {group.entries.length} 题；共 {group.score} 分）</em>
                </div>
                <ul className="paper-doc__chips">
                  {group.entries.map(entry => (
                    <li key={entry.slotId}>
                      <button
                        type="button"
                        className={`paper-doc__chip${entry.kind === 'rule' ? ' paper-doc__chip--rule' : ''}`}
                        title={entry.kind === 'rule' ? '开考时按规则抽题' : undefined}
                        onClick={() => gotoEntry(entry.index)}
                      >
                        {entry.index}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </aside>
      </div>

      <QuestionDetailModal
        entry={activeEntry}
        capNames={capNames}
        onClose={() => setActiveEntry(null)}
      />
    </div>
  );
}

/** 难度文案：抽题题位可能不限难度（旧规则），如实显示而不是硬套一个档次 */
function DifficultyLabel({ entry }: { entry: DocEntry }) {
  const difficulty = docEntryDifficulty(entry);
  return <>{difficulty ? DIFFICULTY_LABELS[difficulty] : '不限难度'}</>;
}

// ── 卷面条目：固定题 / 抽题题位 ─────────────────────────────────

function FixedContent({ entry, capNames }: { entry: DocEntry; capNames: (ids?: string[] | null) => string[] }) {
  const q = entry.question;
  if (!q) {
    return (
      <div className="paper-doc__stem">
        <span className="paper-doc__seq">{entry.index}.</span>
        <Tag color="red">题目缺失</Tag>
        <span style={{ color: 'var(--apple-text-secondary)' }}>该题可能已被删除，请编辑试卷后重新选题</span>
      </div>
    );
  }
  const options = q.objectiveAnswer?.options || [];
  const caps = capNames(q.capabilityIds);
  const refs = q.schemaRefs;
  return (
    <>
      <div className="paper-doc__stem">
        <span className="paper-doc__seq">{entry.index}.</span>
        {q.title}
      </div>
      {q.description && <div className="paper-doc__desc">{q.description}</div>}
      {options.length > 0 && (
        <div className="paper-doc__options">
          {options.map(option => (
            <div key={option.key} className="paper-doc__option">
              <span className="paper-doc__option-key">{option.key}.</span>
              <span className="paper-doc__option-text">{option.text}</span>
            </div>
          ))}
        </div>
      )}
      {(caps.length > 0 || refs) && (
        <div className="paper-doc__refs">
          {caps.length > 0 && <span>知识点：{caps.join('、')}</span>}
          {refs?.tables && refs.tables.length > 0 && <span>涉及表格：{refs.tables.join('、')}</span>}
          {refs?.fields && refs.fields.length > 0 && <span>涉及字段：{refs.fields.join('、')}</span>}
        </div>
      )}
    </>
  );
}

function RuleContent({ entry, capNames }: { entry: DocEntry; capNames: (ids?: string[] | null) => string[] }) {
  const rule = entry.rule;
  const caps = capNames(rule?.capabilityIds);
  const difficulty = rule?.difficulty ? DIFFICULTY_LABELS[rule.difficulty] : '不限难度';
  return (
    <>
      <div className="paper-doc__stem">
        <span className="paper-doc__seq">{entry.index}.</span>
        <Tag color="geekblue">抽题</Tag>
        <span>开考时自动抽题：从{caps.length > 0 ? `「${caps.join('、')}」知识点` : '全部知识点'}中抽取 1 道
          {difficulty}题，每题 {entry.score} 分</span>
      </div>
      <div className="paper-doc__desc">每位学生由系统按同一条件抽取不同题目（同卷内不重复），保证题量分值一致。</div>
    </>
  );
}

// ── 题目详情弹窗（对齐参考产品：左 题目/答案/解析/知识点，右 题目信息）──

function QuestionDetailModal({
  entry, capNames, onClose,
}: {
  entry: DocEntry | null;
  capNames: (ids?: string[] | null) => string[];
  onClose: () => void;
}) {
  if (!entry) return null;
  const q = entry.question;
  const isRule = entry.kind === 'rule';
  const options = q?.objectiveAnswer?.options || [];
  const correct = q?.objectiveAnswer?.correct || [];
  const caps = isRule ? capNames(entry.rule?.capabilityIds) : capNames(q?.capabilityIds);
  const difficulty = docEntryDifficulty(entry);
  const typeLabel = isRule
    ? (entry.rule?.type ? `抽题 · ${questionTypeLabel(entry.rule.type)}` : '抽题 · 不限题型')
    : (q ? questionTypeLabel(q.type) : '—');

  return (
    <Modal title="题目详情" open footer={null} width={820} onCancel={onClose}>
      <div className="paper-qm">
        <div className="paper-qm__main">
          <section className="paper-qm__block">
            <h4>题目</h4>
            {q ? (
              <>
                <div className="paper-qm__stem">{q.title}</div>
                {q.description && <div className="paper-qm__desc">{q.description}</div>}
                {options.length > 0 && (
                  <div className="paper-doc__options">
                    {options.map(option => {
                      const isCorrect = correct.includes(option.key);
                      return (
                        <div key={option.key} className={`paper-doc__option${isCorrect ? ' paper-doc__option--correct' : ''}`}>
                          <span className="paper-doc__option-key">{option.key}.</span>
                          <span className="paper-doc__option-text">{option.text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : isRule ? (
              <div className="paper-qm__stem">
                开考时从{caps.length > 0 ? `「${caps.join('、')}」知识点` : '全部知识点'}中抽取 1 道
                {difficulty ? DIFFICULTY_LABELS[difficulty] : '不限难度'}题（每题 {entry.score} 分），
                为每位学生抽取等值且不重复的题目。
              </div>
            ) : (
              <div className="paper-qm__stem">题目已被删除</div>
            )}
          </section>

          {q && !isRule && (
            <section className="paper-qm__block">
              <h4>答案</h4>
              {q.objectiveAnswer ? (
                <div className="paper-qm__answer">{correct.join('、') || '未设置'}</div>
              ) : (
                <div className="paper-qm__desc">
                  实操题：交卷后由规则引擎按 {q.answerRules?.length ?? 0} 条评分规则自动判分，
                  无法自动判定的规则转人工复核。
                </div>
              )}
            </section>
          )}

          {q?.analysis && (
            <section className="paper-qm__block">
              <h4>解析</h4>
              <div className="paper-qm__desc" style={{ whiteSpace: 'pre-wrap' }}>{q.analysis}</div>
            </section>
          )}

          <section className="paper-qm__block">
            <h4>知识点</h4>
            {caps.length > 0 ? (
              <div className="paper-qm__tags">{caps.map(name => <Tag key={name}>{name}</Tag>)}</div>
            ) : (
              <div className="paper-qm__desc">—</div>
            )}
          </section>
        </div>

        <div className="paper-qm__side">
          <h4>题目信息</h4>
          <dl className="paper-qm__info">
            <div><dt>题型</dt><dd>{typeLabel}</dd></div>
            <div><dt>难度</dt><dd>{difficulty ? DIFFICULTY_LABELS[difficulty] : '不限难度'}</dd></div>
            <div><dt>分值</dt><dd>{entry.score} 分</dd></div>
            <div><dt>来源</dt><dd>{q?.source === 'official' ? '官方题库' : isRule ? '抽题生成' : '校本题库'}</dd></div>
            <div>
              <dt>创建时间</dt>
              <dd>{q?.createdAt ? dayjs(q.createdAt).format('YYYY-MM-DD') : '—'}</dd>
            </div>
            <div>
              <dt>出题人</dt>
              <dd>{q?.teacherName || q?.creator?.realName || (q?.source === 'official' ? '官方题库' : '—')}</dd>
            </div>
          </dl>
        </div>
      </div>
    </Modal>
  );
}
