import React, { useState, useEffect } from 'react';
import { fetchStats } from '../services/api';

const Sidebar = ({ currentView, setCurrentView }) => {
    const [openExceptions, setOpenExceptions] = useState(0);

    useEffect(() => {
        const fetchDashboardStats = async () => {
            try {
                const data = await fetchStats();
                setOpenExceptions(data.open_exceptions);
            } catch (e) {
                console.error(e);
            }
        };

        fetchDashboardStats();
        const interval = setInterval(fetchDashboardStats, 5000);
        return () => clearInterval(interval);
    }, []);

    const navItems = [
        { name: 'Dashboard', icon: 'ri-dashboard-line' },
        { name: 'Pipeline Runs', icon: 'ri-git-merge-line' },
        { name: 'Exception Queue', icon: 'ri-error-warning-line', badge: openExceptions },
        { name: 'Inventory Report', icon: 'ri-stock-line' },
        { name: 'Settings', icon: 'ri-settings-4-line' }
    ];

    return (
        <aside className="sidebar glass-panel">
            <div className="logo">
                <div className="logo-icon"><i className="ri-instance-line"></i></div>
                <h2>Produce.Ai</h2>
            </div>
            
            <nav className="nav-menu">
                {navItems.map(item => (
                    <a 
                        key={item.name} 
                        href="#" 
                        className={`nav-item ${currentView === item.name ? 'active' : ''}`}
                        onClick={(e) => {
                            e.preventDefault();
                            setCurrentView(item.name);
                        }}
                    >
                        <i className={item.icon}></i>
                        <span>{item.name}</span>
                        {item.badge > 0 && <span className="badge danger">{item.badge}</span>}
                    </a>
                ))}
            </nav>

            <div className="user-profile">
                <div className="avatar"><i className="ri-user-line"></i></div>
                <div className="user-info">
                    <p className="name">Prod Manager</p>
                    <p className="role">Admin</p>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
