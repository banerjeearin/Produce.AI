import React, { useState, useEffect } from 'react';
import { getActivities, deleteRunData, getRunState, resumeRun } from '../services/api';

const PipelineRuns = () => {
    const [activities, setActivities] = useState([]);
    const [runStates, setRunStates] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [expandedRuns, setExpandedRuns] = useState({});
    const [isDeleting, setIsDeleting] = useState(false);
    const [isResuming, setIsResuming] = useState(false);

    const fetchAllActivities = async () => {
        try {
            // Fetch up to 200 activities to ensure we get full runs
            const data = await getActivities(200);
            setActivities(data);
            
            // Fetch HITL states for all unique runs
            const uniqueRunIds = [...new Set(data.map(d => d.run_id).filter(Boolean))];
            const states = {};
            for (const rId of uniqueRunIds) {
                try {
                    const st = await getRunState(rId);
                    if (st && st.status !== 'NOT_FOUND') {
                        states[rId] = st;
                    }
                } catch (e) {
                    console.error("Could not fetch state for run", rId, e);
                }
            }
            setRunStates(states);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAllActivities();
        const interval = setInterval(fetchAllActivities, 15000);
        return () => clearInterval(interval);
    }, []);

    const handleDeleteRun = async (e, runId) => {
        e.stopPropagation();
        if (!window.confirm(`Are you sure you want to delete all ingested data for run ${runId}?`)) {
            return;
        }
        setIsDeleting(true);
        try {
            await deleteRunData(runId);
            alert(`Run ${runId} deleted successfully.`);
            await fetchAllActivities();
        } catch (err) {
            console.error(err);
            alert(`Failed to delete run: ${err.message}`);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleResumeRun = async (runId) => {
        setIsResuming(true);
        try {
            await resumeRun(runId);
            alert(`Run ${runId} resumed successfully.`);
            await fetchAllActivities(); // Refresh UI immediately
        } catch (err) {
            console.error(err);
            alert(`Failed to resume run: ${err.message}`);
        } finally {
            setIsResuming(false);
        }
    };

    const getTypeStyle = (type) => {
        if (type === 'SUCCESS') return 'badge success';
        if (type === 'ERROR') return 'badge danger';
        if (type === 'WARNING') return 'badge warning';
        return 'badge primary';
    };

    const formatDate = (dateStr) => {
        const d = new Date(dateStr);
        return d.toLocaleString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    const toggleRun = (runId) => {
        setExpandedRuns(prev => ({ ...prev, [runId]: !prev[runId] }));
    };

    const groupedRuns = activities.reduce((acc, act) => {
        const rId = act.run_id || 'unassigned';
        if (!acc[rId]) acc[rId] = [];
        acc[rId].push(act);
        return acc;
    }, {});

    if (isLoading) {
        return (
            <div className="card glass-panel" style={{ padding: '2rem', textAlign: 'center', marginTop: '2rem' }}>
                <p>Loading Pipeline History...</p>
            </div>
        );
    }

    return (
        <div className="card glass-panel" style={{ marginTop: '2rem' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2><i className="ri-git-merge-line text-primary"></i> Agent-wise Pipeline Runs</h2>
                <span className="badge">{Object.keys(groupedRuns).length} Runs</span>
            </div>
            
            <div style={{ padding: '1.5rem' }}>
                {Object.keys(groupedRuns).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        No pipeline activity recorded yet. Run a pipeline from the dashboard!
                    </div>
                ) : (
                    Object.entries(groupedRuns).map(([runId, runActivities], idx) => {
                        const isExpanded = expandedRuns[runId];
                        const latestTime = runActivities.length > 0 ? formatDate(runActivities[0].created_at) : '';
                        const runState = runStates[runId];
                        const isPaused = runState?.status === 'PAUSED';
                        
                        return (
                            <div key={runId} style={{ marginBottom: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                <div 
                                    style={{ 
                                        padding: '1rem', 
                                        backgroundColor: isPaused ? 'rgba(255, 193, 7, 0.1)' : 'var(--panel-bg)', 
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                    onClick={() => toggleRun(runId)}
                                >
                                    <div>
                                        <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                                            Run: {runId} 
                                            {runState?.values?.raw_orders?.length === 1 && (
                                                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginLeft: '0.5rem' }}>
                                                    (Order {runState.values.raw_orders[0].name || runState.values.raw_orders[0].id})
                                                </span>
                                            )}
                                        </h3>
                                        <small style={{ color: 'var(--text-muted)' }}>Started at: {latestTime}</small>
                                        {isPaused && (
                                            <div style={{ marginTop: '0.5rem' }}>
                                                <span className="badge warning">PENDING APPROVAL</span>
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <button 
                                            onClick={(e) => handleDeleteRun(e, runId)}
                                            style={{ background: 'var(--danger-color)', color: 'white', border: 'none', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                                            disabled={isDeleting}
                                        >
                                            <i className="ri-delete-bin-line"></i> Delete Run Data
                                        </button>
                                        <i className={`ri-arrow-${isExpanded ? 'up' : 'down'}-s-line`} style={{ fontSize: '1.5rem' }}></i>
                                    </div>
                                </div>
                                
                                {isExpanded && (
                                    <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)' }}>
                                        {isPaused && (
                                            <div style={{ background: 'var(--bg-color)', padding: '1.5rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid var(--border-color)' }}>
                                                <h4 style={{ margin: '0 0 1rem 0', color: 'var(--warning-color)' }}>
                                                    <i className="ri-pause-circle-line"></i> Pipeline Paused for Human Review
                                                </h4>
                                                <p>The previous agent has finished execution. Please review the output below.</p>
                                                
                                                {/* Details Table for Review */}
                                                {runState.values?.raw_orders && runState.values.raw_orders.length > 0 && (
                                                    <div style={{ marginTop: '1.5rem', overflowX: 'auto' }}>
                                                        <h5 style={{ marginBottom: '0.5rem', color: 'var(--text-color)' }}>Line Items from Fetched Orders ({
                                                            runState.values.raw_orders.reduce((acc, o) => acc + (o.line_items?.length || 0), 0)
                                                        })</h5>
                                                        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                                            <thead>
                                                                <tr>
                                                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Order ID</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Item</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Qty</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>UOM</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Base Price</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Tax</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Invoice Date</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {runState.values.raw_orders.flatMap(order => 
                                                                    (order.line_items || []).map(item => {
                                                                        const taxAmount = item.tax_lines && item.tax_lines.length > 0 
                                                                            ? item.tax_lines.reduce((sum, t) => sum + parseFloat(t.price || 0), 0) 
                                                                            : 0;
                                                                        const dateStr = order.created_at ? new Date(order.created_at).toLocaleDateString() : 'N/A';
                                                                        return (
                                                                            <tr key={`${order.id}-${item.id}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                                <td style={{ padding: '0.5rem' }}>{order.name || order.id}</td>
                                                                                <td style={{ padding: '0.5rem' }}>{item.name || item.title || item.sku}</td>
                                                                                <td style={{ padding: '0.5rem' }}>{item.quantity}</td>
                                                                                <td style={{ padding: '0.5rem' }}>Nos</td>
                                                                                <td style={{ padding: '0.5rem' }}>{item.price} {order.currency}</td>
                                                                                <td style={{ padding: '0.5rem' }}>{taxAmount.toFixed(2)} {order.currency}</td>
                                                                                <td style={{ padding: '0.5rem' }}>{dateStr}</td>
                                                                            </tr>
                                                                        );
                                                                    })
                                                                ).slice(0, 15)}
                                                            </tbody>
                                                        </table>
                                                        {runState.values.raw_orders.reduce((acc, o) => acc + (o.line_items?.length || 0), 0) > 15 && (
                                                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>* Showing 15 of {runState.values.raw_orders.reduce((acc, o) => acc + (o.line_items?.length || 0), 0)} items.</p>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Details for Classification Review */}
                                                {runState.values?.classified_skus && runState.values.classified_skus.length > 0 && (
                                                    <div style={{ marginTop: '1.5rem' }}>
                                                        <h5 style={{ marginBottom: '0.5rem', color: 'var(--text-color)' }}>Classified SKUs</h5>
                                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                            {runState.values.classified_skus.map((sku, idx) => (
                                                                <span key={idx} className="badge primary" style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}>
                                                                    <i className="ri-price-tag-3-line"></i> {sku}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Details for Work Order Plans */}
                                                {runState.values?.work_order_plans && runState.values.work_order_plans.length > 0 && (
                                                    <div style={{ marginTop: '1.5rem', overflowX: 'auto' }}>
                                                        <h5 style={{ marginBottom: '0.5rem', color: 'var(--text-color)' }}>Generated Production Plans</h5>
                                                        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                                            <thead>
                                                                <tr>
                                                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Item Code</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>Net Quantity</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {runState.values.work_order_plans.map((plan, idx) => (
                                                                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                        <td style={{ padding: '0.5rem' }}>{plan.erp_fg_item_code}</td>
                                                                        <td style={{ padding: '0.5rem' }}>{plan.net_qty}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}

                                                <button
                                                    onClick={() => handleResumeRun(runId)}
                                                    disabled={isResuming}
                                                    style={{ background: 'var(--accent-color)', color: 'white', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.5rem' }}
                                                >
                                                    <i className="ri-play-circle-line"></i> Approve & Execute {runState.next_nodes.join(', ')}
                                                </button>
                                            </div>
                                        )}
                                    
                                        <h5 style={{ margin: '0 0 0.5rem 0' }}>Activity Logs</h5>
                                        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
                                            <thead>
                                                <tr>
                                                    <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Agent</th>
                                                    <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Status</th>
                                                    <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Event</th>
                                                    <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Description</th>
                                                    <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Time</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {runActivities.map((act, idx2) => (
                                                    <tr key={idx2} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                        <td style={{ padding: '0.75rem', fontWeight: 'bold', color: 'var(--accent-color)' }}>{act.agent_name || 'System'}</td>
                                                        <td style={{ padding: '0.75rem' }}>
                                                            <span className={getTypeStyle(act.type)}>{act.type}</span>
                                                        </td>
                                                        <td style={{ padding: '0.75rem', fontWeight: '500' }}>{act.title}</td>
                                                        <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{act.description}</td>
                                                        <td style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{formatDate(act.created_at)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default PipelineRuns;
