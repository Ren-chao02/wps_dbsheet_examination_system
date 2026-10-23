import { useNavigate } from 'react-router-dom';
import { Button, Result, Typography } from 'antd';
import { AuthShell } from './AuthShell';

const { Paragraph } = Typography;

/**
 * 自助注册已关闭（安全修复）：
 * 原注册接口允许请求体自带 role: 'teacher'，任何人一次请求即可获得教师权限。
 * 现在学生通过教师发放的班级邀请链接入班，教师账号由管理员开通。
 * 保留本页面（而不是删路由）是为了给历史书签/外链一个能读懂的去处。
 */
export function RegisterPage() {
  const navigate = useNavigate();

  return (
    <AuthShell>
      <Result
        status="info"
        title="自助注册已关闭"
        subTitle={
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            学生请使用任课教师发放的<strong>班级邀请链接</strong>加入班级；
            <br />
            教师账号请联系管理员开通。
          </Paragraph>
        }
        extra={
          <Button type="primary" onClick={() => navigate('/login')}>
            返回登录
          </Button>
        }
      />
    </AuthShell>
  );
}
