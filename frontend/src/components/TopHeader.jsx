import React, { useState } from 'react';
import { runPipeline } from '../services/api';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const TopHeader = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [dateFrom, setDateFrom] = useState(new Date());
    const [dateTo, setDateTo] = useState(new Date());

    const handleRunPipeline = async () => {
        setIsLoading(true);
        try {
            // Format dates before sending: DD.MM.YYYY
            const formatStr = (d) => {
                if (!d) return null;
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yyyy = d.getFullYear();
                return `${dd}.${mm}.${yyyy}`;
            };
            const result = await runPipeline(formatStr(dateFrom), formatStr(dateTo));
            if (result && result.message) {
                alert(result.message);
            }
        } catch (e) {
            console.error(e);
            alert(`Error: ${e.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const inputStyles = {
        padding: '0.5rem', 
        borderRadius: '4px', 
        border: '1px solid var(--border-color)', 
        background: 'var(--glass-bg)', 
        color: 'var(--text-color)',
        width: '110px'
    };

    return (
        <header className="top-header">
            <div className="header-content">
                <h1>Manufacturing Overview</h1>
                <p className="subtitle">Real-time Shopify to ERPNext Orchestration</p>
            </div>
            <div className="header-actions" style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                    <DatePicker 
                        selected={dateFrom} 
                        onChange={(date) => setDateFrom(date)} 
                        dateFormat="dd.MM.yyyy"
                        placeholderText="DD.MM.YYYY"
                        customInput={<input style={inputStyles} />}
                    />
                    <span style={{color: 'var(--text-muted)'}}>to</span>
                    <DatePicker 
                        selected={dateTo} 
                        onChange={(date) => setDateTo(date)} 
                        dateFormat="dd.MM.yyyy"
                        placeholderText="DD.MM.YYYY"
                        customInput={<input style={inputStyles} />}
                    />
                </div>
                <button 
                    className={`btn btn-primary glow-effect ${isLoading ? 'loading' : ''}`}
                    onClick={handleRunPipeline}
                    disabled={isLoading}
                >
                    <i className={isLoading ? "ri-loader-4-line spin" : "ri-play-line"}></i> 
                    {isLoading ? ' Running...' : ' Run Pipeline'}
                </button>
            </div>
        </header>
    );
};

export default TopHeader;
