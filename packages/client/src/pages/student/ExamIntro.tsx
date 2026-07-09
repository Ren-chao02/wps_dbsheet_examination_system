import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Spin } from 'antd';

export function ExamIntroPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // 重定向到环境检测页面，确保学生完成考前检查和入场步骤
  useEffect(() => {
    if (id) {
      navigate(`/student/exam/${id}/check`, { replace: true });
    }
  }, [id, navigate]);

  // 以下代码仅在重定向前短暂展示 loading 状态
  return (
    <div style={{ textAlign: 'center', padding: 100 }}>
      <Spin size="large" />
    </div>
  );
}
