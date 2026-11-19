import React, { useState } from 'react';
import { Lock, Mail, Building2, ShieldCheck, KeyRound, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { sigaApi, setAuthToken } from '../services/api.ts';
import type { AuthUser } from '../types/siga.ts';

interface LoginPageProps {
  onSuccess: (user: AuthUser) => void;
}

const DEMO_ACCOUNTS = [
  { label: 'Administrador Geral', user: 'admin', pass: 'admin123', sector: 'Todos os setores' },
  { label: 'Gestor da Saúde', user: 'gestor', pass: 'gestor123', sector: 'Visão consolidada' },
  { label: 'Resp. Almoxarifado Central', user: 'resp.central', pass: 'central123', sector: 'Almoxarifado Central (4 áreas)' },
  { label: 'Op. Central (Info/Exp)', user: 'op.central.info', pass: 'centralop123', sector: 'Central · Info & Expediente' },
  { label: 'Resp. Farmácia Básica', user: 'resp.farmacia', pass: 'farmacia123', sector: 'Farmácia Básica' },
  { label: 'Operador Hospital', user: 'op.hospital', pass: 'hospital123', sector: 'Hospital Municipal' },
  { label: 'Operador Sala de Vacina', user: 'op.vacina', pass: 'vacina123', sector: 'Sala de Vacina' },
];

export const LoginPage: React.FC<LoginPageProps> = ({ onSuccess }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryMsg, setRecoveryMsg] = useState('');
  const [imgError, setImgError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await sigaApi.login(identifier, password);
      setAuthToken(res.token);
      onSuccess(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setRecoveryMsg('');
    setLoading(true);
    try {
      const res = await sigaApi.recoverPassword(identifier);
      setRecoveryMsg(res.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (u: string, p: string) => {
    setRecoveryMode(false);
    setError('');
    setIdentifier(u);
    setPassword(p);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-stretch">
      {/* Left Institutional Visual Panel */}
      <div className="hidden lg:flex lg:w-[44%] relative bg-[#0B2545] text-white flex-col justify-between overflow-hidden">
        {!imgError ? (
          <img
            src="/src/assets/images/siga_login_backdrop_1794949017356.jpg"
            alt="Centro de Distribuição Farmacêutica da Saúde Pública"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-35"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B2545] via-[#0B2545]/80 to-[#0B2545]/60" />

        <div className="relative z-10 p-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-display font-bold text-lg tracking-tight text-white">SIGA Saúde</p>
              <p className="text-xs text-blue-200">Secretaria Municipal de Saúde</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 p-10 space-y-6">
          <div className="space-y-3 max-w-md">
            <p className="text-xs font-semibold tracking-wide text-blue-300">
              Miguel Alves – Piauí · Gestão Pública de Insumos
            </p>
            <h1 className="font-display text-3xl font-bold leading-tight text-white [text-wrap:balance]">
              Controle integrado dos estoques municipais de saúde
            </h1>
            <p className="text-sm text-slate-200 leading-relaxed">
              Rastreabilidade completa de lotes, validades FEFO, notas fiscais eletrônicas XML,
              requisições entre setores e inventário físico auditado.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-white/15 text-xs text-slate-200">
            <div>
              <p className="font-semibold text-white">4 Estoques Integrados</p>
              <p className="text-slate-300 mt-0.5">Central · Farmácia · Hospital · Vacinas</p>
            </div>
            <div>
              <p className="font-semibold text-white">Persistência Auditada</p>
              <p className="text-slate-300 mt-0.5">SQLite local + schema Supabase RLS</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Authentication Form */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-10 bg-slate-50">
        <div className="w-full max-w-md space-y-6">
          <div className="lg:hidden flex items-center gap-3 pb-2">
            <div className="w-9 h-9 rounded-lg bg-[#0B2545] flex items-center justify-center text-white">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-lg text-[#0B2545]">SIGA Saúde</h2>
              <p className="text-xs text-slate-500">SMS Miguel Alves – PI</p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs">
            <div className="mb-6">
              <h2 className="font-display text-xl font-bold text-slate-900">
                {recoveryMode ? 'Recuperação de Acesso' : 'Acesso ao Sistema'}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {recoveryMode
                  ? 'Informe seu usuário ou e-mail institucional para registrar a solicitação.'
                  : 'Autentique-se para operar o almoxarifado vinculado ao seu perfil.'}
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            {recoveryMsg && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                <span>{recoveryMsg}</span>
              </div>
            )}

            {!recoveryMode ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Usuário ou E-mail institucional
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="ex: resp.central ou email@miguelalves.pi.gov.br"
                      className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-700">Senha</label>
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryMode(true);
                        setError('');
                      }}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Digite sua senha"
                      className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-10 rounded-lg bg-[#0B2545] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <span>{loading ? 'Autenticando...' : 'Entrar no SIGA Saúde'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <form onSubmit={handleRecovery} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Usuário ou E-mail cadastrado
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="Digite seu e-mail ou nome de usuário"
                      className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setRecoveryMode(false);
                      setRecoveryMsg('');
                      setError('');
                    }}
                    className="h-10 px-4 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
                  >
                    Voltar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 h-10 rounded-lg bg-[#0B2545] hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
                  >
                    {loading ? 'Enviando...' : 'Solicitar Redefinição'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Demo Profiles Selector for Quick Testing */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 mb-3">
              <ShieldCheck className="w-4 h-4 text-blue-700" />
              <span>Perfis de demonstração (banco SQLite local persistido)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.user}
                  type="button"
                  onClick={() => fillDemo(acc.user, acc.pass)}
                  className="text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-blue-600 hover:bg-blue-50/50 transition-colors"
                >
                  <p className="text-xs font-semibold text-slate-900 truncate">{acc.label}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {acc.user} · {acc.sector}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
