import React, { useState, useEffect } from 'react';
import { getActivities, deleteRunData, getRunState, resumeRun, getErpItems, updateSkuMapping } from '../services/api';

const PipelineRuns = () => {
    const [activities, setActivities] = useState([]);
    const [runStates, setRunStates] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [expandedRuns, setExpandedRuns] = useState({});
    const [isDeleting, setIsDeleting] = useState(false);
    const [isResuming, setIsResuming] = useState(false);
    const [erpItemsList, setErpItemsList] = useState([]);
    const [editingMapping, setEditingMapping] = useState(null); // { runId, sku, erpCode, isSaving: false }

    const fetchAllActivities = async () => {
        try {
            // Fetch up to 200 activities to ensure we get full runs
            const data = await getActivities(200);
            setActivities(data);
            
            // Fetch HITL states for all unique runs in parallel for instant loading
            const uniqueRunIds = [...new Set(data.map(d => d.run_id).filter(Boolean))];
            const states = {};
            const results = await Promise.allSettled(
                uniqueRunIds.map(async (rId) => {
                    const st = await getRunState(rId);
                    return { rId, st };
                })
            );
            results.forEach(res => {
                if (res.status === 'fulfilled' && res.value.st && res.value.st.status !== 'NOT_FOUND') {
                    states[res.value.rId] = res.value.st;
                }
            });
            setRunStates(states);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAllActivities();
        // Load available ERPNext items list once
        getErpItems().then(res => {
            if (res && res.items) {
                setErpItemsList(res.items);
            }
        }).catch(err => console.error("Failed to load ERP items:", err));

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

    const handleSaveMapping = async (runId, sku, erpCode) => {
        if (!erpCode || !erpCode.trim()) {
            alert('Please enter a valid ERPNext Item ID / Code');
            return;
        }
        setEditingMapping(prev => ({ ...prev, isSaving: true }));
        try {
            await updateSkuMapping(sku, erpCode.trim(), runId);
            // Re-fetch run state immediately to recalculate live stock and fulfillment strategy
            const updatedState = await getRunState(runId);
            if (updatedState && updatedState.status !== 'NOT_FOUND') {
                setRunStates(prev => ({ ...prev, [runId]: updatedState }));
            }
            setEditingMapping(null);
        } catch (err) {
            console.error(err);
            alert(`Failed to save mapping: ${err.message}`);
            setEditingMapping(prev => ({ ...prev, isSaving: false }));
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
            {/* Global Datalist for ERPNext Item Search */}
            <datalist id="erp-items-datalist">
                {erpItemsList.map(item => (
                    <option key={item.name} value={item.name}>
                        {item.item_name ? `${item.item_name} (${item.name})` : item.name}
                    </option>
                ))}
            </datalist>

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
                                            <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem', border: '1px solid rgba(99, 102, 241, 0.3)', backdropFilter: 'blur(10px)' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.75rem' }}>
                                                    <div>
                                                        <h4 style={{ margin: 0, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
                                                            <i className="ri-shield-user-line"></i> Step-by-Step Human Approval Required
                                                        </h4>
                                                        <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                                            Review or edit classification mappings and verify live stock before proceeding.
                                                        </p>
                                                    </div>
                                                    <span className="badge warning" style={{ fontSize: '0.9rem', padding: '0.35rem 0.75rem' }}>
                                                        Next: {runState.next_nodes.join(' → ').toUpperCase()}
                                                    </span>
                                                </div>

                                                {/* Visual Stage Tracker */}
                                                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', overflowX: 'auto', padding: '0.5rem 0' }}>
                                                    {[
                                                        { id: 'ingestion', label: '1. Ingested' },
                                                        { id: 'classification', label: '2. Classified' },
                                                        { id: 'item_master', label: '3. Item Master' },
                                                        { id: 'allocation', label: '4. Stock Allocation' },
                                                        { id: 'invoicing', label: '5. Sales Invoice' },
                                                        { id: 'bom_generation', label: '6. BOM Recipe' },
                                                        { id: 'planning', label: '7. Work Planning' },
                                                        { id: 'work_order', label: '8. Work Orders' }
                                                    ].map((step, sIdx) => {
                                                        const isCurrent = runState.next_nodes.includes(step.id);
                                                        return (
                                                            <div 
                                                                key={sIdx} 
                                                                style={{ 
                                                                    padding: '0.4rem 0.8rem', 
                                                                    borderRadius: '6px', 
                                                                    fontSize: '0.8rem', 
                                                                    fontWeight: isCurrent ? 'bold' : 'normal',
                                                                    backgroundColor: isCurrent ? 'rgba(234, 179, 8, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                                                    color: isCurrent ? '#fbbf24' : 'var(--text-muted)',
                                                                    border: isCurrent ? '1px solid #fbbf24' : '1px solid transparent',
                                                                    whiteSpace: 'nowrap'
                                                                }}
                                                            >
                                                                {step.label}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                
                                                {/* Order Lines Breakdown */}
                                                {runState.values?.raw_orders && runState.values.raw_orders.length > 0 && (
                                                    <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
                                                        <h5 style={{ marginBottom: '0.5rem', color: 'var(--text-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                            <i className="ri-shopping-cart-2-line text-primary"></i> Order Items & Live ERPNext Stock Comparison
                                                        </h5>
                                                        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                                            <thead>
                                                                <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Order</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Order Date</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Shopify SKU</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>ERP Material Code</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Qty</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Rate</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Discount</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Net Amount</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>GST Breakdown</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>ERP Stock</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Fulfillment Strategy</th>
                                                                    <th style={{ textAlign: 'center', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Action</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {runState.values.raw_orders.flatMap(order => {
                                                                    const orderDateStr = order.created_at ? new Date(order.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
                                                                    return (order.line_items || []).map((item, iIdx) => {
                                                                        const sku = item.sku || item.name;
                                                                        const erpCode = runState.values.erp_item_map?.[sku] || sku;
                                                                        const stock = runState.values.stock_balances?.[sku] ?? 0;
                                                                        const hasFullStock = stock >= item.quantity;
                                                                        const hasPartialStock = stock > 0 && stock < item.quantity;

                                                                        const rate = parseFloat(item.price || 0);
                                                                        const qty = parseInt(item.quantity || 1);
                                                                        const discount = parseFloat(item.total_discount || 0);
                                                                        const netAmt = Math.max(0, (rate * qty) - discount);
                                                                        const taxLines = item.tax_lines || [];
                                                                        const taxRate = taxLines.length > 0 ? parseFloat(taxLines[0].rate || 0) * 100 : 0;
                                                                        const taxAmt = taxLines.reduce((acc, tl) => acc + parseFloat(tl.price || 0), 0);
                                                                        
                                                                        const shipState = order.shipping_address?.province || order.billing_address?.province || '';
                                                                        const isIntra = shipState.toLowerCase().includes('maharashtra') || shipState.toUpperCase() === 'MH';
                                                                        const isEditingThis = editingMapping?.runId === runId && editingMapping?.sku === sku;

                                                                        return (
                                                                            <tr key={`${order.id}-${item.id || iIdx}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                                <td style={{ padding: '0.6rem', fontWeight: '500' }}>{order.name || order.id}</td>
                                                                                <td style={{ padding: '0.6rem', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                                                                                    <i className="ri-calendar-line" style={{ marginRight: '0.25rem' }}></i>{orderDateStr}
                                                                                </td>
                                                                                <td style={{ padding: '0.6rem', color: '#818cf8', fontWeight: '600' }}>{sku}</td>
                                                                                
                                                                                {/* ERP Material Code (Editable) */}
                                                                                <td style={{ padding: '0.6rem', color: '#38bdf8', fontWeight: '500', fontFamily: 'monospace' }}>
                                                                                    {isEditingThis ? (
                                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                            <input 
                                                                                                type="text" 
                                                                                                list="erp-items-datalist" 
                                                                                                value={editingMapping.erpCode}
                                                                                                onChange={(e) => setEditingMapping({ ...editingMapping, erpCode: e.target.value })}
                                                                                                placeholder="Select or enter ERP Item ID"
                                                                                                style={{ 
                                                                                                    background: 'rgba(15, 23, 42, 0.95)', 
                                                                                                    color: '#38bdf8', 
                                                                                                    border: '1px solid #818cf8', 
                                                                                                    borderRadius: '4px', 
                                                                                                    padding: '0.35rem 0.5rem', 
                                                                                                    fontFamily: 'monospace', 
                                                                                                    fontSize: '0.85rem',
                                                                                                    width: '190px'
                                                                                                }}
                                                                                                autoFocus
                                                                                            />
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                                                            <i className="ri-barcode-line"></i>
                                                                                            <span>{erpCode}</span>
                                                                                        </div>
                                                                                    )}
                                                                                </td>

                                                                                <td style={{ padding: '0.6rem', fontWeight: 'bold' }}>{qty} Nos</td>
                                                                                <td style={{ padding: '0.6rem' }}>₹{rate.toFixed(2)}</td>
                                                                                <td style={{ padding: '0.6rem', color: discount > 0 ? '#fbbf24' : 'var(--text-muted)' }}>
                                                                                    {discount > 0 ? `₹${discount.toFixed(2)}` : '₹0.00'}
                                                                                </td>
                                                                                <td style={{ padding: '0.6rem', fontWeight: 'bold', color: '#38bdf8' }}>₹{netAmt.toFixed(2)}</td>
                                                                                <td style={{ padding: '0.6rem', fontSize: '0.8rem' }}>
                                                                                    {taxLines.length > 0 ? (
                                                                                        isIntra ? (
                                                                                            <span style={{ color: '#a78bfa' }}>
                                                                                                CGST ({(taxRate/2).toFixed(1)}%): ₹{(taxAmt/2).toFixed(2)}<br/>
                                                                                                SGST ({(taxRate/2).toFixed(1)}%): ₹{(taxAmt/2).toFixed(2)}
                                                                                            </span>
                                                                                        ) : (
                                                                                            <span style={{ color: '#60a5fa' }}>
                                                                                                IGST ({taxRate.toFixed(1)}%): ₹{taxAmt.toFixed(2)}
                                                                                            </span>
                                                                                        )
                                                                                    ) : (
                                                                                        <span style={{ color: 'var(--text-muted)' }}>0% GST</span>
                                                                                    )}
                                                                                </td>
                                                                                <td style={{ padding: '0.6rem', fontWeight: 'bold', color: hasFullStock ? '#34d399' : (hasPartialStock ? '#fbbf24' : '#f87171') }}>
                                                                                    <i className={hasFullStock ? "ri-checkbox-circle-fill text-success" : "ri-database-2-line"}></i> {stock} Nos
                                                                                </td>
                                                                                <td style={{ padding: '0.6rem' }}>
                                                                                    {hasFullStock ? (
                                                                                        <span className="badge success" style={{ fontSize: '0.75rem' }}>
                                                                                            <i className="ri-check-line"></i> Direct Invoicing
                                                                                        </span>
                                                                                    ) : hasPartialStock ? (
                                                                                        <span className="badge warning" style={{ fontSize: '0.75rem' }}>
                                                                                            <i className="ri-split-cells-horizontal"></i> Partial + {qty - stock} to MFR
                                                                                        </span>
                                                                                    ) : (
                                                                                        <span className="badge danger" style={{ fontSize: '0.75rem' }}>
                                                                                            <i className="ri-hammer-line"></i> Shortage ({qty} Nos)
                                                                                        </span>
                                                                                    )}
                                                                                </td>

                                                                                {/* Edit / Save Action Column */}
                                                                                <td style={{ padding: '0.6rem', textAlign: 'center' }}>
                                                                                    {isEditingThis ? (
                                                                                        <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                                                                                            <button 
                                                                                                onClick={() => handleSaveMapping(runId, sku, editingMapping.erpCode)}
                                                                                                disabled={editingMapping.isSaving}
                                                                                                style={{ 
                                                                                                    background: '#10b981', 
                                                                                                    color: 'white', 
                                                                                                    border: 'none', 
                                                                                                    borderRadius: '4px', 
                                                                                                    padding: '0.3rem 0.6rem', 
                                                                                                    cursor: 'pointer', 
                                                                                                    fontSize: '0.75rem',
                                                                                                    display: 'flex',
                                                                                                    alignItems: 'center',
                                                                                                    gap: '0.25rem'
                                                                                                }}
                                                                                                title="Save Mapping"
                                                                                            >
                                                                                                <i className={editingMapping.isSaving ? "ri-loader-4-line ri-spin" : "ri-check-line"}></i> Save
                                                                                            </button>
                                                                                            <button 
                                                                                                onClick={() => setEditingMapping(null)}
                                                                                                style={{ 
                                                                                                    background: 'rgba(255,255,255,0.1)', 
                                                                                                    color: 'var(--text-muted)', 
                                                                                                    border: 'none', 
                                                                                                    borderRadius: '4px', 
                                                                                                    padding: '0.3rem 0.5rem', 
                                                                                                    cursor: 'pointer', 
                                                                                                    fontSize: '0.75rem' 
                                                                                                }}
                                                                                                title="Cancel"
                                                                                            >
                                                                                                <i className="ri-close-line"></i>
                                                                                            </button>
                                                                                        </div>
                                                                                    ) : (
                                                                                        <button 
                                                                                            onClick={() => setEditingMapping({ runId, sku, erpCode })}
                                                                                            style={{ 
                                                                                                background: 'rgba(99, 102, 241, 0.15)', 
                                                                                                color: '#818cf8', 
                                                                                                border: '1px solid rgba(99, 102, 241, 0.3)', 
                                                                                                borderRadius: '4px', 
                                                                                                padding: '0.25rem 0.55rem', 
                                                                                                cursor: 'pointer', 
                                                                                                fontSize: '0.75rem',
                                                                                                display: 'inline-flex',
                                                                                                alignItems: 'center',
                                                                                                gap: '0.25rem'
                                                                                            }}
                                                                                            title="Edit Classification Mapping"
                                                                                        >
                                                                                            <i className="ri-edit-line"></i> Edit
                                                                                        </button>
                                                                                    )}
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    });
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}

                                                {/* Details for Sales Invoices Generated */}
                                                {runState.values?.sales_invoices && runState.values.sales_invoices.length > 0 && (
                                                    <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.3)', borderRadius: '8px' }}>
                                                        <h5 style={{ margin: '0 0 0.5rem 0', color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                            <i className="ri-file-list-3-line"></i> ERPNext Sales Invoices Created (Stock Fulfilled)
                                                        </h5>
                                                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                            {runState.values.sales_invoices.map((inv, idx) => (
                                                                <div key={idx} style={{ background: 'var(--panel-bg)', padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid rgba(52, 211, 153, 0.4)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                    <span style={{ fontWeight: 'bold', color: '#34d399', fontFamily: 'monospace', fontSize: '0.95rem' }}>
                                                                        <i className="ri-receipt-line"></i> Invoice #: {inv.erp_invoice_id}
                                                                    </span>
                                                                    <span className="badge success" style={{ fontSize: '0.75rem' }}>{inv.status}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Details for Classified SKUs */}
                                                {runState.values?.classified_skus && runState.values.classified_skus.length > 0 && (
                                                    <div style={{ marginTop: '1.25rem' }}>
                                                        <h5 style={{ marginBottom: '0.5rem', color: 'var(--text-color)' }}>Classified Finished Goods SKUs</h5>
                                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                            {runState.values.classified_skus.map((sku, idx) => (
                                                                <span key={idx} className="badge primary" style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}>
                                                                    <i className="ri-t-shirt-line"></i> {sku}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Details for Work Order Production Plans */}
                                                {runState.values?.work_order_plans && runState.values.work_order_plans.length > 0 && (
                                                    <div style={{ marginTop: '1.25rem', overflowX: 'auto' }}>
                                                        <h5 style={{ marginBottom: '0.5rem', color: '#f87171' }}>
                                                            <i className="ri-tools-line"></i> Net Shortage Work Orders To Generate
                                                        </h5>
                                                        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                                            <thead>
                                                                <tr>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Production Item Code</th>
                                                                    <th style={{ textAlign: 'left', padding: '0.6rem', borderBottom: '1px solid var(--border-color)' }}>Net Shortage Qty to Produce</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {runState.values.work_order_plans.map((plan, idx) => (
                                                                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                                        <td style={{ padding: '0.6rem', fontWeight: 'bold' }}>{plan.erp_fg_item_code}</td>
                                                                        <td style={{ padding: '0.6rem', color: '#f87171', fontWeight: 'bold' }}>{plan.net_qty} Nos</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}

                                                {/* Step Approval Action */}
                                                <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                                    <button
                                                        onClick={() => handleResumeRun(runId)}
                                                        disabled={isResuming}
                                                        style={{ 
                                                            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', 
                                                            color: 'white', 
                                                            border: 'none', 
                                                            padding: '0.75rem 1.75rem', 
                                                            borderRadius: '8px', 
                                                            cursor: 'pointer', 
                                                            fontWeight: 'bold', 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            gap: '0.5rem',
                                                            boxShadow: '0 4px 14px rgba(79, 70, 229, 0.4)'
                                                        }}
                                                    >
                                                        <i className="ri-checkbox-circle-line" style={{ fontSize: '1.1rem' }}></i> 
                                                        Approve & Run Next Agent: {runState.next_nodes.join(', ').toUpperCase()}
                                                    </button>
                                                </div>
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
                                                    <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Doc Reference</th>
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
                                                        <td style={{ padding: '0.75rem' }}>
                                                            {act.doc_reference ? (
                                                                <span style={{ 
                                                                    fontFamily: 'monospace', 
                                                                    color: '#38bdf8', 
                                                                    background: 'rgba(56, 189, 248, 0.1)', 
                                                                    border: '1px solid rgba(56, 189, 248, 0.3)', 
                                                                    padding: '0.2rem 0.5rem', 
                                                                    borderRadius: '4px',
                                                                    fontSize: '0.8rem',
                                                                    fontWeight: '600',
                                                                    display: 'inline-block'
                                                                }}>
                                                                    {act.doc_reference}
                                                                </span>
                                                            ) : (
                                                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                                                            )}
                                                        </td>
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
