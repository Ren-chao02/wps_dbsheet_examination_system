import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';

export default function ForbiddenPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const handleBack = () => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (user.role === 'admin') navigate('/admin');
    else if (user.role === 'teacher') navigate('/teacher');
    else navigate('/student');
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <Result
        status="403"
        title="403"
        subTitle="抱歉，您没有权限访问此页面。"
        extra={
          <Button type="primary" onClick={handleBack}>
            返回首页
          </Button>
        }
      />
    </div>
  );
}
