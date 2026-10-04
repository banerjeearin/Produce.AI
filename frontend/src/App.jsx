import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import TopHeader from './components/TopHeader';
import StatsGrid from './components/StatsGrid';
import ExceptionTable from './components/ExceptionTable';
import ActivityFeed from './components/ActivityFeed';
import PipelineRuns from './components/PipelineRuns';
import Settings from './components/Settings';
import InventoryReport from './components/InventoryReport';
import MaterialMaster from './components/MaterialMaster';
import RecipeMaster from './components/RecipeMaster';
import BomMaster from './components/BomMaster';

function App() {
  const [currentView, setCurrentView] = useState('Dashboard');
  const [dateFrom, setDateFrom] = useState(new Date(2025, 6, 1)); // 01.07.2025
  const [dateTo, setDateTo] = useState(new Date(2025, 6, 31));  // 31.07.2025

  // Format dates as DD.MM.YYYY
  const formatStr = (d) => {
    if (!d) return null;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  };

  const formattedDateFrom = formatStr(dateFrom);
  const formattedDateTo = formatStr(dateTo);

  useEffect(() => {
    // Simple micro-interaction script from mockup
    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(button => {
      button.addEventListener('mousedown', () => button.style.transform = 'scale(0.95)');
      button.addEventListener('mouseup', () => button.style.transform = 'scale(1)');
      button.addEventListener('mouseleave', () => button.style.transform = 'scale(1)');
    });
  }, []);

  const renderView = () => {
    if (currentView === 'Dashboard') {
      return (
        <>
          <StatsGrid dateFrom={formattedDateFrom} dateTo={formattedDateTo} />
          <div className="dashboard-content">
            <ExceptionTable />
            <ActivityFeed dateFrom={formattedDateFrom} dateTo={formattedDateTo} />
          </div>
        </>
      );
    }
    
    if (currentView === 'Pipeline Runs') {
      return <PipelineRuns dateFrom={formattedDateFrom} dateTo={formattedDateTo} />;
    }
    
    if (currentView === 'Exception Queue') {
      return (
        <div style={{ marginTop: '2rem' }}>
          <ExceptionTable />
        </div>
      );
    }
    
    if (currentView === 'Settings') {
      return <Settings />;
    }
    
    if (currentView === 'Inventory Report') {
      return <InventoryReport />;
    }
    
    if (currentView === 'Material Master') {
      return <MaterialMaster />;
    }

    if (currentView === 'Recipe Master') {
      return <RecipeMaster />;
    }

    if (currentView === 'BOM Master') {
      return <BomMaster />;
    }
    
    return (
      <div className="card glass-panel" style={{ padding: '2rem', textAlign: 'center', marginTop: '2rem' }}>
        <h2><i className="ri-tools-line text-primary" style={{ marginRight: '0.5rem' }}></i> {currentView}</h2>
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>This component view is currently under construction.</p>
      </div>
    );
  };

  return (
    <div className="app-container">
      <Sidebar currentView={currentView} setCurrentView={setCurrentView} />
      <main className="main-content">
        <TopHeader 
          dateFrom={dateFrom} 
          setDateFrom={setDateFrom} 
          dateTo={dateTo} 
          setDateTo={setDateTo} 
        />
        {renderView()}
      </main>
    </div>
  );
}

export default App;

