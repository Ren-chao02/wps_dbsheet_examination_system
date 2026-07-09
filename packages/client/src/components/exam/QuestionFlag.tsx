import { Button } from 'antd';
import { FlagOutlined, FlagFilled } from '@ant-design/icons';

interface QuestionFlagProps {
  flagged: boolean;
  onToggle: () => void;
}

export function QuestionFlag({ flagged, onToggle }: QuestionFlagProps) {
  return (
    <Button
      icon={flagged ? <FlagFilled /> : <FlagOutlined />}
      type={flagged ? 'primary' : 'default'}
      danger={flagged}
      size="small"
      onClick={onToggle}
    >
      {flagged ? '已标记' : '标记本题'}
    </Button>
  );
}
