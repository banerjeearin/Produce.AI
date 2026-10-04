import React, { useState, forwardRef } from 'react';
import { runPipeline } from '../services/api';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

// Custom input with forwardRef so react-datepicker can bind click and focus events properly
const DateInputCustom = forwardRef(({ value, onClick, placeholder }, ref) => (
    <button
        type="button"
        className="date-input-btn"
        onClick={onClick}
        ref={ref}
    >
        <i className="ri-calendar-line" style={{ color: 'var(--primary)', marginRight: '6px' }}></i>
        <span>{value || placeholder || 'Select date'}</span>
    </button>
));
DateInputCustom.displayName = 'DateInputCustom';

const TopHeader = ({ dateFrom, setDateFrom, dateTo, setDateTo }) => {
    const [isLoading, setIsLoading] = useState(false);

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

    return (
        <header className="top-header">
            <div className="header-content">
                <h1>Manufacturing Overview</h1>
                <p className="subtitle">Real-time Shopify to ERPNext Orchestration</p>
            </div>
            <div className="header-actions" style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
                <div className="date-range-container">
                    <DatePicker 
                        selected={dateFrom} 
                        onChange={(date) => setDateFrom(date)} 
                        selectsStart
                        startDate={dateFrom}
                        endDate={dateTo}
                        dateFormat="dd.MM.yyyy"
                        placeholderText="DD.MM.YYYY"
                        customInput={<DateInputCustom />}
                        popperPlacement="bottom-start"
                    />
                    <span className="date-separator">to</span>
                    <DatePicker 
                        selected={dateTo} 
                        onChange={(date) => setDateTo(date)} 
                        selectsEnd
                        startDate={dateFrom}
                        endDate={dateTo}
                        minDate={dateFrom}
                        dateFormat="dd.MM.yyyy"
                        placeholderText="DD.MM.YYYY"
                        customInput={<DateInputCustom />}
                        popperPlacement="bottom-start"
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
