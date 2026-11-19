import React, { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  BarChart3,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileCode2,
  FolderTree,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PackagePlus,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import { LoginPage } from './components/LoginPage.tsx';
import { AlmoxarifadoCentralView } from './components/views/AlmoxarifadoCentralView.tsx';
import { CategoriesView, ProductFormView, ProductsView, SuppliersView } from './components/views/CatalogViews.tsx';
import { DashboardView } from './components/views/DashboardView.tsx';
import { BatchesView, ExitsView } from './components/views/MovementsAndBatchViews.tsx';
import { AuditView, ReportsView, SectorsView, SettingsView, UsersView } from './components/views/ReportsAndAdminViews.tsx';
import { ManualEntryView, SectorStocksView, XmlImportView } from './components/views/StockAndEntryViews.tsx';
import { InventoryView, RequisitionsView, TransfersView } from './components/views/WorkflowViews.tsx';
import { getAuthToken, setAuthToken, sigaApi } from './services/api.ts';
import type { AppSettings, AuthUser, Product, ScreenId, Sector } from './types/siga.ts';
import { ROLE_ALLOWED_SCREENS, ROLE_LABELS } from './types/siga.ts';

interface NavItem {
  id: ScreenId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'geral' | 'operacoes' | 'cadastros' | 'governanca';
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'geral' },
  { id: 'almoxarifado-central', label: 'Almoxarifado Central', icon: Warehouse, group: 'operacoes' },
  { id: 'estoques', label: 'Estoques por Setor', icon: Boxes, group: 'operacoes' },
  { id: 'lotes', label: 'Lotes e Validade', icon: CalendarClock, group: 'operacoes' },
  { id: 'entradas', label: 'Entrada de Produtos', icon: ArrowDownToLine, group: 'operacoes' },
  { id: 'importar-xml', label: 'Importação de XML', icon: FileCode2, group: 'operacoes' },
  { id: 'saidas', label: 'Saídas', icon: ArrowUpFromLine, group: 'operacoes' },
  { id: 'transferencias', label: 'Transferências', icon: ArrowRightLeft, group: 'operacoes' },
  { id: 'requisicoes', label: 'Requisições', icon: ClipboardList, group: 'operacoes' },
  { id: 'inventario', label: 'Inventário', icon: ClipboardCheck, group: 'operacoes' },
  { id: 'produtos', label: 'Produtos', icon: Package, group: 'cadastros' },
  { id: 'novo-produto', label: 'Novo Produto', icon: PackagePlus, group: 'cadastros' },
  { id: 'categorias', label: 'Categorias', icon: FolderTree, group: 'cadastros' },
  { id: 'fornecedores', label: 'Fornecedores', icon: Truck, group: 'cadastros' },
  { id: 'relatorios', label: 'Relatórios', icon: BarChart3, group: 'governanca' },
  { id: 'usuarios', label: 'Usuários', icon: Users, group: 'governanca' },
  { id: 'setores', label: 'Setores', icon: Warehouse, group: 'governanca' },
  { id: 'auditoria', label: 'Auditoria', icon: ShieldCheck, group: 'governanca' },
  { id: 'configuracoes', label: 'Configurações', icon: Settings, group: 'governanca' },
];

const GROUP_TITLES: Record<NavItem['group'], string> = {
  geral: 'Visão Geral',
  operacoes: 'Movimentação e Controle',
  cadastros: 'Catálogo e Fornecedores',
  governanca: 'Relatórios e Administração',
};

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeScreen, setActiveScreen] = useState<ScreenId>('dashboard');
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    institution_name: 'Secretaria Municipal de Saúde de Miguel Alves – PI',
    municipality: 'Miguel Alves – PI',
    expiry_alert_days: [180, 90, 60, 30],
    fefo_enforced: true,
    block_expired_normal_exit: true,
  });
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [centralContext, setCentralContext] = useState<{ sectorId?: number; subdivisionId?: number; reportKey?: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const loadBootstrap = async () => {
    const [secList, appSet] = await Promise.all([
      sigaApi.get<Sector[]>('/api/sectors'),
      sigaApi.get<AppSettings>('/api/settings'),
    ]);
    setSectors(secList);
    setSettings(appSet);
  };

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setCheckingAuth(false);
      return;
    }
    sigaApi
      .me()
      .then(async (res) => {
        setUser(res.user);
        await loadBootstrap();
      })
      .catch(() => {
        setAuthToken(null);
      })
      .finally(() => setCheckingAuth(false));
  }, []);

  const handleLoginSuccess = async (loggedUser: AuthUser) => {
    setUser(loggedUser);
    setActiveScreen('dashboard');
    await loadBootstrap();
  };

  const handleLogout = async () => {
    try {
      await sigaApi.logout();
    } catch {
      // Ignore if already expired
    }
    setAuthToken(null);
    setUser(null);
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-600">
        Verificando sessão institucional...
      </div>
    );
  }

  if (!user) {
    return <LoginPage onSuccess={handleLoginSuccess} />;
  }

  const allowedScreens = ROLE_ALLOWED_SCREENS[user.role];
  const canSeeCentral = user.role === 'ADMINISTRADOR' || user.role === 'GESTOR' || user.sector_id === 1;
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!allowedScreens.includes(item.id)) return false;
    if (item.id === 'almoxarifado-central' && !canSeeCentral) return false;
    return true;
  });
  const currentTitle = NAV_ITEMS.find((i) => i.id === activeScreen)?.label || 'Dashboard';

  const navigate = (screen: ScreenId, ctx?: { sectorId?: number; subdivisionId?: number; reportKey?: string }) => {
    if (!allowedScreens.includes(screen)) return;
    if (screen === 'almoxarifado-central' && !canSeeCentral) return;
    if (screen !== 'novo-produto') setEditingProduct(null);
    setCentralContext(ctx || null);
    setActiveScreen(screen);
    setMobileMenuOpen(false);
  };

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-[#0B2545] text-slate-100">
      <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="font-display font-bold text-base text-white leading-tight truncate">SIGA Saúde</p>
            <p className="text-[11px] text-blue-200 truncate">Miguel Alves – PI</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1 text-slate-300 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {(['geral', 'operacoes', 'cadastros', 'governanca'] as const).map((group) => {
          const items = visibleItems.filter((i) => i.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="space-y-1">
              <p className="px-3 text-[11px] font-semibold text-blue-200/70 tracking-wide">
                {GROUP_TITLES[group]}
              </p>
              {items.map((item) => {
                const Icon = item.icon;
                const active = activeScreen === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-200 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10 text-xs space-y-2">
        <div>
          <p className="font-semibold text-white truncate">{user.full_name}</p>
          <p className="text-blue-200 truncate">
            {ROLE_LABELS[user.role]} · {user.sector_name || 'Visão Consolidada'}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Encerrar Sessão</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[264px] shrink-0 border-r border-slate-200 sticky top-0 h-screen">
        {renderSidebarContent()}
      </aside>

      {/* Mobile / Tablet Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-[270px] h-full">{renderSidebarContent()}</div>
          <div className="flex-1 bg-slate-900/50" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Clean Institutional Top Bar */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="font-semibold text-slate-500 hidden sm:inline">SMS Miguel Alves – PI</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <span className="font-display font-semibold text-slate-900 truncate">{currentTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0 text-xs text-slate-600">
            <span className="hidden md:inline font-medium text-slate-700">
              {user.sector_name || 'Gestão Central (4 Estoques)'}
            </span>
            <span className="hidden md:inline text-slate-300">|</span>
            <span className="font-semibold text-[#0B2545]">{ROLE_LABELS[user.role]}</span>
          </div>
        </header>

        {/* Active Module Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          {activeScreen === 'dashboard' && <DashboardView user={user} sectors={sectors} onNavigate={navigate} />}
          {activeScreen === 'almoxarifado-central' && canSeeCentral && (
            <AlmoxarifadoCentralView
              user={user}
              settings={settings}
              onNavigateWithContext={(screen, ctx) => navigate(screen, ctx)}
            />
          )}
          {activeScreen === 'produtos' && (
            <ProductsView
              user={user}
              onNewProduct={() => {
                setEditingProduct(null);
                navigate('novo-produto');
              }}
              onEditProduct={(p) => {
                setEditingProduct(p);
                setActiveScreen('novo-produto');
              }}
            />
          )}
          {activeScreen === 'novo-produto' && (
            <ProductFormView
              user={user}
              defaultSubdivisionId={centralContext?.subdivisionId}
              editingProduct={editingProduct}
              onSaved={() => {
                setEditingProduct(null);
                navigate('produtos');
              }}
              onCancel={() => {
                setEditingProduct(null);
                navigate('produtos');
              }}
            />
          )}
          {activeScreen === 'categorias' && <CategoriesView />}
          {activeScreen === 'fornecedores' && <SuppliersView />}
          {activeScreen === 'estoques' && (
            <SectorStocksView
              user={user}
              sectors={sectors}
              defaultSectorId={centralContext?.sectorId}
              defaultSubdivisionId={centralContext?.subdivisionId}
            />
          )}
          {activeScreen === 'entradas' && (
            <ManualEntryView
              user={user}
              sectors={sectors}
              defaultSectorId={centralContext?.sectorId}
              defaultSubdivisionId={centralContext?.subdivisionId}
              onGoXml={() => navigate('importar-xml', centralContext || undefined)}
            />
          )}
          {activeScreen === 'importar-xml' && (
            <XmlImportView
              user={user}
              sectors={sectors}
              defaultSectorId={centralContext?.sectorId}
              defaultSubdivisionId={centralContext?.subdivisionId}
            />
          )}
          {activeScreen === 'saidas' && (
            <ExitsView
              user={user}
              sectors={sectors}
              settings={settings}
              defaultSectorId={centralContext?.sectorId}
              defaultSubdivisionId={centralContext?.subdivisionId}
            />
          )}
          {activeScreen === 'lotes' && <BatchesView user={user} sectors={sectors} settings={settings} />}
          {activeScreen === 'transferencias' && <TransfersView user={user} sectors={sectors} />}
          {activeScreen === 'requisicoes' && <RequisitionsView user={user} sectors={sectors} />}
          {activeScreen === 'inventario' && <InventoryView user={user} sectors={sectors} />}
          {activeScreen === 'relatorios' && (
            <ReportsView
              user={user}
              sectors={sectors}
              defaultSectorId={centralContext?.sectorId}
              defaultSubdivisionId={centralContext?.subdivisionId}
              defaultReportKey={centralContext?.reportKey}
            />
          )}
          {activeScreen === 'usuarios' && <UsersView sectors={sectors} />}
          {activeScreen === 'setores' && (
            <SectorsView
              onSectorsUpdated={() => {
                sigaApi.get<Sector[]>('/api/sectors').then(setSectors);
              }}
            />
          )}
          {activeScreen === 'auditoria' && <AuditView />}
          {activeScreen === 'configuracoes' && <SettingsView settings={settings} onUpdated={setSettings} />}
        </main>
      </div>
    </div>
  );
}
