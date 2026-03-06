import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './Login.css';

const SERVER_BASE = process.env.REACT_APP_SERVER_URL || '';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'credentials' | 'code' | 'forgot'>('credentials');
  const { login, verify2FA } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const result = await login({ email, password });
      if (result === '2fa') {
        setStep('code');
      } else if (!result) {
        setError('Email ou senha incorretos');
      }
    } catch (err) {
      setError('Erro ao fazer login. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const res = await fetch(`${SERVER_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erro ao recuperar senha');
      }
      setSuccessMsg('Nova senha enviada para seu email.');
    } catch (err: any) {
      setError(err.message || 'Erro ao recuperar senha');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const success = await verify2FA(code);
      if (!success) {
        setError('Código inválido ou expirado');
      }
    } catch (err) {
      setError('Erro ao verificar código. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setLoading(true);
    setCode('');
    try {
      const result = await login({ email, password });
      if (result === '2fa') {
        setError('');
      } else {
        setError('Erro ao reenviar código');
      }
    } catch {
      setError('Erro ao reenviar código');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>Rosenbaum Advogados</h1>
          <p>Sistema de Chat</p>
        </div>

        {step === 'credentials' ? (
          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label htmlFor="email">Email:</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Digite seu email"
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Senha:</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha"
                required
                disabled={loading}
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>

            <button
              type="button"
              className="otp-resend"
              onClick={() => { setStep('forgot'); setError(''); setSuccessMsg(''); }}
              disabled={loading}
            >
              Esqueci minha senha
            </button>
          </form>
        ) : step === 'forgot' ? (
          <form onSubmit={handleForgotPassword} className="login-form">
            <p className="otp-info">
              Digite seu email para receber uma nova senha temporária.
            </p>

            <div className="form-group">
              <label htmlFor="forgot-email">Email:</label>
              <input
                type="email"
                id="forgot-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Digite seu email"
                required
                autoFocus
                disabled={loading}
              />
            </div>

            {error && <div className="error-message">{error}</div>}
            {successMsg && <div className="success-message">{successMsg}</div>}

            <button type="submit" className="login-button" disabled={loading || !email}>
              {loading ? 'Enviando...' : 'Enviar nova senha'}
            </button>

            <button
              type="button"
              className="otp-back"
              onClick={() => { setStep('credentials'); setError(''); setSuccessMsg(''); }}
              disabled={loading}
            >
              Voltar ao login
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="login-form">
            <p className="otp-info">
              Código de verificação enviado para <strong>{email}</strong>
            </p>

            <div className="form-group">
              <label htmlFor="code">Código:</label>
              <input
                type="text"
                id="code"
                className="otp-input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                inputMode="numeric"
                autoFocus
                required
                disabled={loading}
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button type="submit" className="login-button" disabled={loading || code.length !== 6}>
              {loading ? 'Verificando...' : 'Verificar'}
            </button>

            <button
              type="button"
              className="otp-resend"
              onClick={handleResend}
              disabled={loading}
            >
              Reenviar código
            </button>

            <button
              type="button"
              className="otp-back"
              onClick={() => { setStep('credentials'); setCode(''); setError(''); }}
              disabled={loading}
            >
              Voltar
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default Login;
