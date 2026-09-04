import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { CreateProjectPage } from './pages/CreateProjectPage';
import { DashboardPage } from './pages/DashboardPage';
import { InternationalCheckoutPage } from './pages/InternationalCheckoutPage';
import { AIOrchestrationPage } from './pages/AIOrchestrationPage';
import { LegalPage } from './pages/legalpage';
import { EnterpriseDashboardFrame } from './components/EnterpriseDashboardFrame';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/create" element={<CreateProjectPage />} />
        <Route path="/app" element={<EnterpriseDashboardFrame><DashboardPage /></EnterpriseDashboardFrame>} />
        <Route path="/app/ai/:projectSlug" element={<EnterpriseDashboardFrame><AIOrchestrationPage /></EnterpriseDashboardFrame>} />
        <Route path="/billing/international" element={<InternationalCheckoutPage />} />
        <Route path="/legal/:doc" element={<LegalPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
