import { Card, Empty, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

export function FavoriteQuestions() {
  const navigate = useNavigate();
  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: 16 }}>
        <h2>我的收藏</h2>
      </div>
      <Card>
        <Empty description="收藏功能正在完善中">
          <Button type="primary" onClick={() => navigate('/student/practice')}>
            去练习
          </Button>
        </Empty>
      </Card>
    </div>
  );
}
