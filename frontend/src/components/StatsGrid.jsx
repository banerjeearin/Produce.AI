import React, { useState, useEffect } from 'react';
import { fetchStats } from '../services/api';

const StatsGrid = () => {
    const [stats, setStats] = useState({
        orders_processed: 0,
        work_orders_created: 0,
        open_exceptions: 0
    });

    useEffect(() => {
        fetchStats().then(setStats).catch(console.error);
        const interval = setInterval(() => {
            fetchStats().then(setStats).catch(console.error);
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <section className="stats-grid">
            <div className="stat-card glass-panel">
                <div className="stat-icon primary"><i className="ri-shopping-cart-2-line"></i></div>
                <div className="stat-details">
                    <p className="stat-label">Orders Processed</p>
                    <h3 className="stat-value">{stats.orders_processed}</h3>
                    <p className="stat-trend neutral"><i className="ri-subtract-line"></i> Live</p>
                </div>
            </div>
            
            <div className="stat-card glass-panel">
                <div className="stat-icon success"><i className="ri-hammer-line"></i></div>
                <div className="stat-details">
                    <p className="stat-label">Work Orders Created</p>
                    <h3 className="stat-value">{stats.work_orders_created}</h3>
                    <p className="stat-trend neutral"><i className="ri-subtract-line"></i> Live</p>
                </div>
            </div>

            <div className="stat-card glass-panel">
                <div className="stat-icon danger"><i className="ri-alert-line"></i></div>
                <div className="stat-details">
                    <p className="stat-label">Open Exceptions</p>
                    <h3 className="stat-value">{stats.open_exceptions}</h3>
                    <p className="stat-trend negative"><i className="ri-arrow-up-line"></i> Live</p>
                </div>
            </div>
        </section>
    );
};

export default StatsGrid;
