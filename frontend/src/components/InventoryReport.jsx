import React, { useState, useEffect } from 'react';
import { getInventoryReport } from '../services/api';

const InventoryReport = () => {
    // Default to today
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [reportData, setReportData] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchReport = async (dateStr) => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await getInventoryReport(dateStr);
            setReportData(result.data || []);
        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // Fetch on initial load with default date
    useEffect(() => {
        fetchReport(selectedDate);
        // eslint-disable-next-line
    }, []);

    const handleFetchClick = () => {
        fetchReport(selectedDate);
    };

    return (
        <div className="card glass-panel" style={{ marginTop: '2rem' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <h2><i className="ri-stock-line text-primary"></i> Inventory Report</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Search Items</label>
                        <input 
                            type="text" 
                            placeholder="Search by code or name..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{
                                padding: '0.5rem',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--panel-bg)',
                                color: 'var(--text-color)',
                                minWidth: '200px'
                            }}
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>As of Date</label>
                        <input 
                            type="date" 
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            style={{
                                padding: '0.5rem',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--panel-bg)',
                                color: 'var(--text-color)'
                            }}
                        />
                    </div>
                    <button 
                        onClick={handleFetchClick} 
                        className="btn-primary" 
                        disabled={isLoading}
                        style={{ alignSelf: 'flex-end', height: '38px' }}
                    >
                        {isLoading ? 'Loading...' : 'Fetch Report'}
                    </button>
                </div>
            </div>
            
            <div style={{ padding: '1.5rem' }}>
                {error && (
                    <div style={{ padding: '1rem', background: 'var(--danger-color)', color: 'white', borderRadius: '4px', marginBottom: '1rem' }}>
                        <i className="ri-error-warning-line"></i> {error}
                    </div>
                )}
                
                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: '2rem' }}>
                        <i className="ri-loader-4-line" style={{ fontSize: '2rem', animation: 'spin 1s linear infinite' }}></i>
                        <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Fetching Inventory Data...</p>
                    </div>
                ) : reportData.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        No inventory data found for the selected date.
                    </div>
                ) : (
                    <div>
                        {(() => {
                            const filteredData = reportData.filter(row => 
                                (row.item_code || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                                (row.item_name || '').toLowerCase().includes(searchQuery.toLowerCase())
                            );

                            const rawMaterials = filteredData.filter(row => (row.item_code || '').startsWith('STO'));
                            const finishedGoods = filteredData.filter(row => (row.item_code || '').startsWith('4'));
                            const others = filteredData.filter(row => !(row.item_code || '').startsWith('STO') && !(row.item_code || '').startsWith('4'));

                            const renderTable = (title, data) => (
                                <div style={{ marginBottom: '2rem' }}>
                                    <h3 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>{title} ({data.length})</h3>
                                    {data.length === 0 ? (
                                        <p style={{ color: 'var(--text-muted)' }}>No items found in this category.</p>
                                    ) : (
                                        <div style={{ overflowX: 'auto' }}>
                                            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr>
                                                        <th style={{ textAlign: 'left', padding: '1rem', borderBottom: '2px solid var(--border-color)' }}>Item Code</th>
                                                        <th style={{ textAlign: 'left', padding: '1rem', borderBottom: '2px solid var(--border-color)' }}>Item Name</th>
                                                        <th style={{ textAlign: 'left', padding: '1rem', borderBottom: '2px solid var(--border-color)' }}>Stock Type</th>
                                                        <th style={{ textAlign: 'right', padding: '1rem', borderBottom: '2px solid var(--border-color)' }}>Quantity</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {data.map((row, idx) => (
                                                        <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                            <td style={{ padding: '1rem', fontWeight: '500', color: 'var(--accent-color)' }}>{row.item_code}</td>
                                                            <td style={{ padding: '1rem' }}>{row.item_name}</td>
                                                            <td style={{ padding: '1rem' }}><span className="badge">{row.stock_type}</span></td>
                                                            <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 'bold' }}>{row.quantity} {row.uom}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            );

                            return (
                                <>
                                    {renderTable("Raw Material", rawMaterials)}
                                    {renderTable("Finished Goods", finishedGoods)}
                                    {others.length > 0 && renderTable("Other Items", others)}
                                </>
                            );
                        })()}
                    </div>
                )}
            </div>
        </div>
    );
};

export default InventoryReport;
