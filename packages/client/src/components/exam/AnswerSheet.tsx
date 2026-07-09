import { Button, Space, Tooltip } from 'antd';

interface AnswerSheetProps {
  total: number;
  current: number;
  answered: Set<number>;
  flagged: Set<number>;
  onChange: (index: number) => void;
}

export function AnswerSheet({ total, current, answered, flagged, onChange }: AnswerSheetProps) {
  return (
    <Space wrap style={{ padding: 12, background: '#fafafa', borderRadius: 8 }}>
      {Array.from({ length: total }).map((_, i) => {
        const isAnswered = answered.has(i);
        const isFlagged = flagged.has(i);
        const isCurrent = i === current;
        let type: 'default' | 'primary' | 'dashed' = 'default';
        if (isCurrent) type = 'primary';
        else if (isAnswered) type = 'primary';
        else if (isFlagged) type = 'dashed';
        return (
          <Tooltip key={i} title={`第 ${i + 1} 题${isFlagged ? '（已标记）' : ''}`}>
            <Button
              type={type}
              danger={isFlagged}
              size="small"
              style={{ width: 36, padding: 0 }}
              onClick={() => onChange(i)}
            >
              {i + 1}
            </Button>
          </Tooltip>
        );
      })}
    </Space>
  );
}
