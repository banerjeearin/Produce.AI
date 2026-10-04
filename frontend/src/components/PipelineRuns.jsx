import React, { useState, useEffect } from 'react';
import { 
    getActivities, deleteRunData, getRunState, resumeRun, 
    autoRunPipeline, massAutoRunPipelines, getErpItems, updateSkuMapping,
    fetchBomSummary 
} from '../services/api';

const PipelineRuns = ({ dateFrom, dateTo }) => {
    const [activities, setActivities] = useState([]);
    const [runStates, setRunStates] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [expandedRuns, setExpandedRuns] = useState({});
    const [isDeleting, setIsDeleting] = useState(false);
    const [isResuming, setIsResuming] = useState(false);
    const [selectedRunIds, setSelectedRunIds] = useState([]);
    const [isMassRunning, setIsMassRunning] = useState(false);
    const [autoRunningRunId, setAutoRunningRunId] = useState(null);
    const [erpItemsList, setErpItemsList] = useState([]);
    const [editingMapping, setEditingMapping] = useState(null); // { runId, sku, erpCode, isSaving: false }
    const [copiedDocId, setCopiedDocId] = useState(null);
    const [bomSummaryData, setBomSummaryData] = useState(null);
    const [isBomSummaryOpen, setIsBomSummaryOpen] = useState(true);

    const loadBomSummary = async () => {
        try {
            const data = await fetchBomSummary(dateFrom, dateTo);
            setBomSummaryData(data);
        } catch (err) {
            console.error("Failed to load BOM summary:", err);
        }
    };

    const fetchAllActivities = async () => {
        try {
            // Fetch activities filtered by selected date range
            const data = await getActivities(300, dateFrom, dateTo);
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
        loadBomSummary();
        // Load available ERPNext items list once
        getErpItems().then(res => {
            if (res && res.items) {
                setErpItemsList(res.items);
            }
        }).catch(err => console.error("Failed to load ERP items:", err));

        const interval = setInterval(() => {
            fetchAllActivities();
            loadBomSummary();
        }, 10000);
        return () => clearInterval(interval);
    }, [dateFrom, dateTo]);

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

    // Manual single-step resume (as-is manual process)
    const handleResumeRun = async (runId) => {
        setIsResuming(true);
        try {
            await resumeRun(runId);
            await fetchAllActivities(); // Refresh UI immediately
        } catch (err) {
            console.error(err);
            alert(`Failed to resume run: ${err.message}`);
        } finally {
            setIsResuming(false);
        }
    };

    // Auto-execute all stages for a SINGLE run
    const handleAutoRunSingle = async (runId) => {
        setAutoRunningRunId(runId);
        try {
            await autoRunPipeline(runId);
            await fetchAllActivities();
        } catch (err) {
            console.error(err);
            alert(`Auto-run error for ${runId}: ${err.message}`);
        } finally {
            setAutoRunningRunId(null);
        }
    };

    // Toggle single run selection checkbox
    const handleToggleSelectRun = (e, runId) => {
        e.stopPropagation();
        setSelectedRunIds(prev => 
            prev.includes(runId) ? prev.filter(id => id !== runId) : [...prev, runId]
        );
    };

    // Select all / Deselect all pending runs
    const handleSelectAllPending = (e) => {
        const pausedRunIds = Object.keys(groupedRuns).filter(rId => runStates[rId]?.status === 'PAUSED');
        if (selectedRunIds.length === pausedRunIds.length && pausedRunIds.length > 0) {
            setSelectedRunIds([]);
        } else {
            setSelectedRunIds(pausedRunIds);
        }
    };

    // Mass execute either SELECTED runs or all pending runs
    const handleMassAutoRun = async () => {
        const pausedRunIds = Object.keys(groupedRuns).filter(rId => {
            const st = runStates[rId];
            return st && st.status === 'PAUSED';
        });

        // If user has specific checkboxes checked, run those; otherwise fallback to all pending
        const targetRunIds = selectedRunIds.length > 0 
            ? selectedRunIds.filter(id => runStates[id]?.status === 'PAUSED')
            : pausedRunIds;

        if (targetRunIds.length === 0) {
            alert('No pending/paused runs selected for mass processing.');
            return;
        }

        if (!window.confirm(`Are you sure you want to mass-process all stages for ${targetRunIds.length} selected run(s)?`)) {
            return;
        }

        setIsMassRunning(true);
        try {
            const res = await massAutoRunPipelines(targetRunIds);
            alert(res.message || `Started mass processing for ${targetRunIds.length} runs.`);
            setSelectedRunIds([]); // Reset selection
            setTimeout(fetchAllActivities, 2000);
            setTimeout(fetchAllActivities, 5000);
        } catch (err) {
            console.error(err);
            alert(`Failed mass processing: ${err.message}`);
        } finally {
            setIsMassRunning(false);
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

    const pendingRuns = Object.keys(groupedRuns).filter(rId => runStates[rId]?.status === 'PAUSED');
    const pendingRunsCount = pendingRuns.length;
    const isAllSelected = pendingRunsCount > 0 && selectedRunIds.length === pendingRunsCount;

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

            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h2><i className="ri-git-merge-line text-primary"></i> Agent-wise Pipeline Runs</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0 0' }}>
                        Showing runs for selected date range • {pendingRunsCount} Pending Human Approval
                    </p>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {/* Select All Checkbox */}
                    {pendingRunsCount > 0 && (
                        <label 
                            style={{ 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '0.4rem', 
                                cursor: 'pointer', 
                                fontSize: '0.85rem', 
                                color: 'var(--text-main)',
                                background: 'rgba(255,255,255,0.06)',
                                padding: '0.45rem 0.75rem',
                                borderRadius: '6px',
                                border: '1px solid var(--border-glass)'
                            }}
                        >
                            <input 
                                type="checkbox" 
                                checked={isAllSelected} 
                                onChange={handleSelectAllPending}
                                style={{ accentColor: 'var(--primary)', cursor: 'pointer', width: '15px', height: '15px' }}
                            />
                            <span>Select All ({selectedRunIds.length}/{pendingRunsCount})</span>
                        </label>
                    )}

                    <span className="badge" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                        {Object.keys(groupedRuns).length} Total Runs
                    </span>

                    {/* Mass Auto-Process Button */}
                    <button
                        onClick={handleMassAutoRun}
                        disabled={isMassRunning || (selectedRunIds.length === 0 && pendingRunsCount === 0)}
                        style={{
                            background: (selectedRunIds.length > 0 || pendingRunsCount > 0)
                                ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
                                : 'rgba(255,255,255,0.05)',
                            color: (selectedRunIds.length > 0 || pendingRunsCount > 0) ? '#ffffff' : 'var(--text-muted)',
                            border: 'none',
                            padding: '0.55rem 1.25rem',
                            borderRadius: '8px',
                            cursor: (selectedRunIds.length > 0 || pendingRunsCount > 0) ? 'pointer' : 'not-allowed',
                            fontWeight: '600',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            fontSize: '0.85rem',
                            boxShadow: (selectedRunIds.length > 0 || pendingRunsCount > 0) ? '0 4px 12px rgba(16, 185, 129, 0.35)' : 'none',
                            transition: 'all 0.2s ease'
                        }}
                        title="Mass-execute all remaining stages for selected or all active runs"
                    >
                        <i className={isMassRunning ? "ri-loader-4-line spin" : "ri-flashlight-fill"}></i>
                        {isMassRunning 
                            ? 'Mass Processing...' 
                            : selectedRunIds.length > 0 
                                ? `Mass Process Selected (${selectedRunIds.length})` 
                                : `Mass Process All Stages (${pendingRunsCount})`
                        }
                    </button>
                </div>
            </div>
            
            {/* BOM Summary for Selected Period Panel */}
            {bomSummaryData && bomSummaryData.summary && bomSummaryData.summary.length > 0 && (
                <div style={{ margin: '1.25rem 1.5rem 0 1.5rem', background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '10px', overflow: 'hidden' }}>
                    <div 
                        onClick={() => setIsBomSummaryOpen(!isBomSummaryOpen)}
                        style={{ 
                            padding: '0.85rem 1.25rem', 
                            background: 'rgba(99, 102, 241, 0.12)', 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center', 
                            cursor: 'pointer',
                            borderBottom: isBomSummaryOpen ? '1px solid rgba(99, 102, 241, 0.2)' : 'none'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: '600', color: '#c7d2fe', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <i className="ri-file-list-3-line" style={{ color: '#818cf8', fontSize: '1.1rem' }}></i> 
                                Period BOM Requirements Summary ({bomSummaryData.total_items} Finished Goods)
                            </span>
                            <span className="badge success" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                                {bomSummaryData.active_boms} Active BOMs
                            </span>
                            {bomSummaryData.missing_boms > 0 ? (
                                <span className="badge warning" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                                    {bomSummaryData.missing_boms} BOMs To Create
                                </span>
                            ) : (
                                <span className="badge success" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                                    All BOMs Ready
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            <span>{isBomSummaryOpen ? 'Hide Summary' : 'View Details'}</span>
                            <i className={`ri-arrow-${isBomSummaryOpen ? 'up' : 'down'}-s-line`} style={{ fontSize: '1.2rem' }}></i>
                        </div>
                    </div>

                    {isBomSummaryOpen && (
                        <div style={{ padding: '1rem', overflowX: 'auto' }}>
                            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                <thead>
                                    <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)' }}>Shopify SKU</th>
                                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)' }}>ERP Material Code</th>
                                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)' }}>Finished Good Item Name</th>
                                        <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)' }}>Total Demand (Qty)</th>
                                        <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)' }}>Orders Count</th>
                                        <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)' }}>ERPNext BOM ID</th>
                                        <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)' }}>BOM Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {bomSummaryData.summary.map((item, sIdx) => {
                                        const isSkuCopied = copiedDocId === `bom-sku-${item.shopify_sku}`;
                                        const isMatCopied = copiedDocId === `bom-mat-${item.erp_material_code}`;
                                        return (
                                            <tr key={sIdx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                                {/* Shopify SKU */}
                                                <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', color: '#93c5fd', fontWeight: '500' }}>
                                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                                        <span>{item.shopify_sku}</span>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                navigator.clipboard.writeText(item.shopify_sku);
                                                                setCopiedDocId(`bom-sku-${item.shopify_sku}`);
                                                                setTimeout(() => setCopiedDocId(null), 2000);
                                                            }}
                                                            style={{
                                                                background: isSkuCopied ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                                                                border: isSkuCopied ? '1px solid #10b981' : '1px solid var(--border-glass)',
                                                                color: isSkuCopied ? '#10b981' : 'var(--text-muted)',
                                                                borderRadius: '4px',
                                                                padding: '0.1rem 0.35rem',
                                                                cursor: 'pointer',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                fontSize: '0.75rem'
                                                            }}
                                                            title={isSkuCopied ? "Copied!" : "Copy Shopify SKU"}
                                                        >
                                                            <i className={isSkuCopied ? "ri-check-line" : "ri-file-copy-line"}></i>
                                                        </button>
                                                    </div>
                                                </td>

                                                {/* ERP Material Code */}
                                                <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace' }}>
                                                    {item.erp_material_code ? (
                                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                                            <span style={{ color: '#38bdf8', fontWeight: '700', background: 'rgba(56, 189, 248, 0.1)', padding: '0.15rem 0.4rem', borderRadius: '4px', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                                                                {item.erp_material_code}
                                                            </span>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    navigator.clipboard.writeText(item.erp_material_code);
                                                                    setCopiedDocId(`bom-mat-${item.erp_material_code}`);
                                                                    setTimeout(() => setCopiedDocId(null), 2000);
                                                                }}
                                                                style={{
                                                                    background: isMatCopied ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                                                                    border: isMatCopied ? '1px solid #10b981' : '1px solid var(--border-glass)',
                                                                    color: isMatCopied ? '#10b981' : 'var(--text-muted)',
                                                                    borderRadius: '4px',
                                                                    padding: '0.1rem 0.35rem',
                                                                    cursor: 'pointer',
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    fontSize: '0.75rem'
                                                                }}
                                                                title={isMatCopied ? "Copied!" : "Copy Material Code"}
                                                            >
                                                                <i className={isMatCopied ? "ri-check-line" : "ri-file-copy-line"}></i>
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <span style={{ color: '#f59e0b', fontSize: '0.75rem', fontStyle: 'italic', background: 'rgba(245, 158, 11, 0.1)', padding: '0.15rem 0.4rem', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                                                            <i className="ri-alert-line"></i> Unmapped in ERP
                                                        </span>
                                                    )}
                                                </td>

                                                <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-main)', maxWidth: '280px' }}>{item.item_name}</td>
                                                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 'bold', color: '#f8fafc' }}>
                                                    {item.total_ordered_qty} Nos
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                                    {item.orders_count}
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem' }}>
                                                    {item.existing_bom ? (
                                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                                            <span style={{ 
                                                                fontFamily: 'monospace', 
                                                                color: '#34d399', 
                                                                background: 'rgba(16, 185, 129, 0.1)', 
                                                                border: '1px solid rgba(16, 185, 129, 0.3)', 
                                                                padding: '0.15rem 0.4rem', 
                                                                borderRadius: '4px', 
                                                                fontSize: '0.75rem',
                                                                fontWeight: '600'
                                                            }}>
                                                                {item.existing_bom}
                                                            </span>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    navigator.clipboard.writeText(item.existing_bom);
                                                                    setCopiedDocId(`bom-doc-${item.existing_bom}`);
                                                                    setTimeout(() => setCopiedDocId(null), 2000);
                                                                }}
                                                                style={{
                                                                    background: copiedDocId === `bom-doc-${item.existing_bom}` ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                                                                    border: copiedDocId === `bom-doc-${item.existing_bom}` ? '1px solid #10b981' : '1px solid var(--border-glass)',
                                                                    color: copiedDocId === `bom-doc-${item.existing_bom}` ? '#10b981' : 'var(--text-muted)',
                                                                    borderRadius: '4px',
                                                                    padding: '0.1rem 0.35rem',
                                                                    cursor: 'pointer',
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    fontSize: '0.75rem'
                                                                }}
                                                                title={copiedDocId === `bom-doc-${item.existing_bom}` ? "Copied!" : "Copy BOM ID"}
                                                            >
                                                                <i className={copiedDocId === `bom-doc-${item.existing_bom}` ? "ri-check-line" : "ri-file-copy-line"}></i>
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                                                    )}
                                                </td>
                                                <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                                                    {item.bom_status === 'ACTIVE' ? (
                                                        <span className="badge success" style={{ fontSize: '0.75rem' }}>
                                                            <i className="ri-checkbox-circle-fill"></i> Active in ERP
                                                        </span>
                                                    ) : item.bom_status === 'RECIPE_READY' ? (
                                                        <span className="badge warning" style={{ fontSize: '0.75rem' }}>
                                                            <i className="ri-tools-fill"></i> Recipe Ready
                                                        </span>
                                                    ) : (
                                                        <span className="badge danger" style={{ fontSize: '0.75rem' }}>
                                                            <i className="ri-alert-fill"></i> Needs Recipe
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
            
            <div style={{ padding: '1.5rem' }}>
                {Object.keys(groupedRuns).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        No pipeline activity recorded in this date range. Run a pipeline from the dashboard!
                    </div>
                ) : (
                    Object.entries(groupedRuns).map(([runId, runActivities], idx) => {
                        const isExpanded = expandedRuns[runId];
                        const latestTime = runActivities.length > 0 ? formatDate(runActivities[0].created_at) : '';
                        const runState = runStates[runId];
                        const isPaused = runState?.status === 'PAUSED';
                        const isSelected = selectedRunIds.includes(runId);
                        
                        return (
                            <div key={runId} style={{ marginBottom: '1rem', border: isSelected ? '1px solid #10b981' : '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', transition: 'border 0.2s ease' }}>
                                <div 
                                    style={{ 
                                        padding: '1rem', 
                                        backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.08)' : isPaused ? 'rgba(255, 193, 7, 0.1)' : 'var(--panel-bg)', 
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                    onClick={() => toggleRun(runId)}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                                        {/* Individual Checkbox for Mass Action */}
                                        {isPaused && (
                                            <input 
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={(e) => handleToggleSelectRun(e, runId)}
                                                onClick={(e) => e.stopPropagation()}
                                                style={{ 
                                                    accentColor: '#10b981', 
                                                    width: '18px', 
                                                    height: '18px', 
                                                    cursor: 'pointer' 
                                                }}
                                                title="Select for mass processing"
                                            />
                                        )}
                                        <div>
                                            <h3 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                Run: {runId} 
                                                {runState?.values?.raw_orders?.length === 1 && (
                                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                                        (Order {runState.values.raw_orders[0].name || runState.values.raw_orders[0].id})
                                                    </span>
                                                )}
                                            </h3>
                                            <small style={{ color: 'var(--text-muted)' }}>Started at: {latestTime}</small>
                                            {isPaused ? (
                                                <div style={{ marginTop: '0.4rem' }}>
                                                    <span className="badge warning">PENDING APPROVAL</span>
                                                </div>
                                            ) : (
                                                <div style={{ marginTop: '0.4rem' }}>
                                                    <span className="badge success">COMPLETED</span>
                                                </div>
                                            )}
                                        </div>
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
                                                        { id: 'allocation', label: '3. Stock Allocation' },
                                                        { id: 'invoicing', label: '4. Sales Invoice' },
                                                        { id: 'bom_generation', label: '5. BOM Recipe' },
                                                        { id: 'planning', label: '6. Work Planning' },
                                                        { id: 'work_order', label: '7. Work Orders' }
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

                                                {/* Step-by-Step Approval AND Full Auto-Run Actions */}
                                                <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                    {/* 1. Step-by-Step Manual Approval (As-is) */}
                                                    <button
                                                        onClick={() => handleResumeRun(runId)}
                                                        disabled={isResuming || autoRunningRunId === runId}
                                                        style={{ 
                                                            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', 
                                                            color: 'white', 
                                                            border: 'none', 
                                                            padding: '0.75rem 1.5rem', 
                                                            borderRadius: '8px', 
                                                            cursor: 'pointer', 
                                                            fontWeight: 'bold', 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            gap: '0.5rem',
                                                            boxShadow: '0 4px 14px rgba(79, 70, 229, 0.4)'
                                                        }}
                                                    >
                                                        <i className={isResuming ? "ri-loader-4-line spin" : "ri-checkbox-circle-line"} style={{ fontSize: '1.1rem' }}></i> 
                                                        {isResuming ? 'Running Step...' : `Approve & Run Next Agent: ${runState.next_nodes.join(', ').toUpperCase()}`}
                                                    </button>

                                                    {/* 2. Auto-Process All Remaining Stages for this Single Run */}
                                                    <button
                                                        onClick={() => handleAutoRunSingle(runId)}
                                                        disabled={isResuming || autoRunningRunId === runId}
                                                        style={{ 
                                                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                                                            color: 'white', 
                                                            border: 'none', 
                                                            padding: '0.75rem 1.5rem', 
                                                            borderRadius: '8px', 
                                                            cursor: 'pointer', 
                                                            fontWeight: 'bold', 
                                                            display: 'flex', 
                                                            alignItems: 'center', 
                                                            gap: '0.5rem',
                                                            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)'
                                                        }}
                                                        title="Execute all stages until completion for this order without asking for further approvals"
                                                    >
                                                        <i className={autoRunningRunId === runId ? "ri-loader-4-line spin" : "ri-flashlight-line"} style={{ fontSize: '1.1rem' }}></i> 
                                                        {autoRunningRunId === runId ? 'Auto-Running All Stages...' : 'Auto-Run All Remaining Stages'}
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
                                                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
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
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            navigator.clipboard.writeText(act.doc_reference);
                                                                            const key = `${act.id || idx2}-${act.doc_reference}`;
                                                                            setCopiedDocId(key);
                                                                            setTimeout(() => setCopiedDocId(null), 2000);
                                                                        }}
                                                                        style={{
                                                                            background: copiedDocId === `${act.id || idx2}-${act.doc_reference}` ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                                                                            border: copiedDocId === `${act.id || idx2}-${act.doc_reference}` ? '1px solid #10b981' : '1px solid var(--border-glass)',
                                                                            color: copiedDocId === `${act.id || idx2}-${act.doc_reference}` ? '#10b981' : 'var(--text-muted)',
                                                                            borderRadius: '4px',
                                                                            padding: '0.2rem 0.4rem',
                                                                            cursor: 'pointer',
                                                                            display: 'inline-flex',
                                                                            alignItems: 'center',
                                                                            fontSize: '0.8rem',
                                                                            transition: 'all 0.15s ease'
                                                                        }}
                                                                        title={copiedDocId === `${act.id || idx2}-${act.doc_reference}` ? "Copied!" : "Copy Reference"}
                                                                    >
                                                                        <i className={copiedDocId === `${act.id || idx2}-${act.doc_reference}` ? "ri-check-line" : "ri-file-copy-line"}></i>
                                                                    </button>
                                                                </div>
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
