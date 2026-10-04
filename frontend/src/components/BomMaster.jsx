import React, { useState, useEffect } from 'react';
import { 
    getBomList, 
    getBomDetails, 
    createBomDirect, 
    toggleBomStatus,
    getErpItems
} from '../services/api';

const BomMaster = () => {
    // Mode tabs: 'display', 'create', 'inspect'
    const [activeTab, setActiveTab] = useState('display');

    // List & Pagination State
    const [boms, setBoms] = useState([]);
    const [totalBoms, setTotalBoms] = useState(0);
    const [page, setPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Single BOM Inspection State
    const [inspectBomId, setInspectBomId] = useState('');
    const [selectedBomDetails, setSelectedBomDetails] = useState(null);
    const [inspectLoading, setInspectLoading] = useState(false);
    const [inspectError, setInspectError] = useState(null);

    // Create BOM Form State
    const [createForm, setCreateForm] = useState({
        item_code: '',
        quantity: 1.0,
        is_active: 1,
        is_default: 1,
        use_recipe_master: true,
        description: ''
    });
    const [createLoading, setCreateLoading] = useState(false);
    const [createFeedback, setCreateFeedback] = useState(null);

    // Available ERP Items list for item selector
    const [erpItems, setErpItems] = useState([]);

    // Load available ERP items for dropdown
    useEffect(() => {
        getErpItems().then(res => {
            if (res && res.items) setErpItems(res.items);
        }).catch(err => console.error("Error loading ERP items:", err));
    }, []);

    // Load paginated list of BOMs
    const loadBoms = async (p = 1, search = searchQuery) => {
        setLoading(true);
        setError(null);
        try {
            const data = await getBomList(search, p, 20);
            setBoms(data.items || []);
            setTotalBoms(data.total || 0);
            setPage(data.page || 1);
        } catch (err) {
            setError(err.message || 'Failed to load BOM Master list');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadBoms(1, searchQuery);
    }, [searchQuery]);

    // Inspect single BOM
    const handleInspect = async (bomId) => {
        if (!bomId) return;
        setInspectLoading(true);
        setInspectError(null);
        try {
            const res = await getBomDetails(bomId);
            setSelectedBomDetails(res);
            setInspectBomId(bomId);
            setActiveTab('inspect');
        } catch (err) {
            setInspectError(err.message || `Failed to fetch details for ${bomId}`);
        } finally {
            setInspectLoading(false);
        }
    };

    // Toggle default status
    const handleToggleDefault = async (bom) => {
        const newDefault = bom.is_default ? 0 : 1;
        try {
            await toggleBomStatus(bom.name, { is_default: newDefault });
            loadBoms(page);
            if (selectedBomDetails && selectedBomDetails.bom.name === bom.name) {
                handleInspect(bom.name);
            }
        } catch (err) {
            alert(err.message || 'Failed to update default status');
        }
    };

    // Handle Create BOM
    const handleCreateBom = async (e) => {
        e.preventDefault();
        if (!createForm.item_code.trim()) {
            setCreateFeedback({ type: 'error', message: 'Item Code is required' });
            return;
        }

        setCreateLoading(true);
        setCreateFeedback(null);

        try {
            const res = await createBomDirect({
                item_code: createForm.item_code.trim(),
                quantity: parseFloat(createForm.quantity) || 1.0,
                is_active: createForm.is_active,
                is_default: createForm.is_default,
                use_recipe_master: createForm.use_recipe_master,
                description: createForm.description.trim() || undefined
            });
            setCreateFeedback({
                type: 'success',
                message: res.message || 'BOM created successfully in ERPNext!'
            });
            setCreateForm({
                item_code: '',
                quantity: 1.0,
                is_active: 1,
                is_default: 1,
                use_recipe_master: true,
                description: ''
            });
            loadBoms(1);
        } catch (err) {
            setCreateFeedback({
                type: 'error',
                message: err.message || 'Failed to create BOM in ERPNext.'
            });
        } finally {
            setCreateLoading(false);
        }
    };

    return (
        <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Header Banner */}
            <div className="card glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #6366f1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ fontSize: '1.35rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <i className="ri-node-tree" style={{ color: '#818cf8' }}></i>
                            BOM Master Node (Bill of Materials Directory)
                        </h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                            Official ERPNext Manufacturing Bill of Materials directory. View active default BOMs, raw material breakdowns, output batch quantities, and costing.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <button
                            onClick={() => loadBoms(page)}
                            disabled={loading}
                            style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                color: '#e2e8f0',
                                border: '1px solid rgba(255, 255, 255, 0.15)',
                                padding: '0.45rem 0.85rem',
                                borderRadius: '8px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                fontSize: '0.82rem'
                            }}
                        >
                            <i className={loading ? "ri-loader-4-line spin" : "ri-refresh-line"}></i>
                            <span>{loading ? 'Refreshing...' : 'Refresh BOMs'}</span>
                        </button>
                        <span className="badge" style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', padding: '0.5rem 1rem', borderRadius: '20px' }}>
                            {totalBoms} BOMs in ERPNext
                        </span>
                    </div>
                </div>
            </div>

            {/* Navigation Sub-Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '0.5rem' }}>
                <button
                    onClick={() => setActiveTab('display')}
                    style={{
                        padding: '0.6rem 1.25rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: activeTab === 'display' ? 'var(--primary-color)' : 'transparent',
                        color: activeTab === 'display' ? '#fff' : 'var(--text-muted)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}
                >
                    <i className="ri-list-check"></i>
                    Display BOM Directory
                </button>

                <button
                    onClick={() => setActiveTab('create')}
                    style={{
                        padding: '0.6rem 1.25rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: activeTab === 'create' ? 'var(--primary-color)' : 'transparent',
                        color: activeTab === 'create' ? '#fff' : 'var(--text-muted)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}
                >
                    <i className="ri-add-line"></i>
                    Create New BOM
                </button>

                <button
                    onClick={() => setActiveTab('inspect')}
                    style={{
                        padding: '0.6rem 1.25rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: activeTab === 'inspect' ? 'var(--primary-color)' : 'transparent',
                        color: activeTab === 'inspect' ? '#fff' : 'var(--text-muted)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}
                >
                    <i className="ri-search-eye-line"></i>
                    Inspect BOM Details {selectedBomDetails ? `(${selectedBomDetails.bom.name})` : ''}
                </button>
            </div>

            {/* TAB 1: DISPLAY / DIRECTORY */}
            {activeTab === 'display' && (
                <div className="card glass-panel" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                        <div>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Master BOM Directory</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                Showing {boms.length} of {totalBoms} active manufacturing BOMs
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                            <input
                                type="text"
                                placeholder="Search by BOM ID, Item Code, or Name..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{
                                    padding: '0.5rem 0.85rem',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '6px',
                                    color: '#fff',
                                    fontSize: '0.85rem',
                                    width: '300px'
                                }}
                            />
                            <button 
                                className="btn btn-primary"
                                onClick={() => setActiveTab('create')}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem', fontSize: '0.85rem' }}
                            >
                                <i className="ri-add-line"></i> New BOM
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                            <i className="ri-loader-4-line ri-spin" style={{ fontSize: '1.8rem', display: 'block', marginBottom: '0.5rem' }}></i>
                            Loading BOMs from ERPNext...
                        </div>
                    ) : error ? (
                        <div style={{ padding: '1rem', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                            {error}
                        </div>
                    ) : (
                        <>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--text-muted)' }}>
                                            <th style={{ padding: '0.75rem' }}>BOM Document ID</th>
                                            <th style={{ padding: '0.75rem' }}>Item Code</th>
                                            <th style={{ padding: '0.75rem' }}>Finished Good Name</th>
                                            <th style={{ padding: '0.75rem' }}>Output Qty</th>
                                            <th style={{ padding: '0.75rem' }}>Estimated Cost</th>
                                            <th style={{ padding: '0.75rem', textAlign: 'center' }}>Default BOM</th>
                                            <th style={{ padding: '0.75rem', textAlign: 'center' }}>Status</th>
                                            <th style={{ padding: '0.75rem', textAlign: 'right' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {boms.map((b) => (
                                            <tr key={b.name} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                                <td style={{ padding: '0.75rem', fontFamily: 'monospace' }}>
                                                    <span style={{ 
                                                        color: '#34d399', 
                                                        background: 'rgba(16, 185, 129, 0.1)', 
                                                        border: '1px solid rgba(16, 185, 129, 0.3)', 
                                                        padding: '0.2rem 0.5rem', 
                                                        borderRadius: '4px',
                                                        fontWeight: 600
                                                    }}>
                                                        {b.name}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '0.75rem', color: '#38bdf8', fontWeight: 600, fontFamily: 'monospace' }}>
                                                    {b.item}
                                                </td>
                                                <td style={{ padding: '0.75rem', color: '#f8fafc', fontWeight: 500, maxWidth: '240px' }}>
                                                    {b.item_name || b.item}
                                                </td>
                                                <td style={{ padding: '0.75rem', color: '#f1f5f9', fontWeight: 600 }}>
                                                    {b.quantity} {b.uom || 'Nos'}
                                                </td>
                                                <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>
                                                    {b.total_cost ? `₹${parseFloat(b.total_cost).toFixed(2)}` : '—'}
                                                </td>
                                                <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                                                    <button
                                                        onClick={() => handleToggleDefault(b)}
                                                        style={{
                                                            background: b.is_default ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                                                            color: b.is_default ? '#10b981' : '#94a3b8',
                                                            border: `1px solid ${b.is_default ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
                                                            borderRadius: '12px',
                                                            padding: '0.2rem 0.6rem',
                                                            fontSize: '0.75rem',
                                                            cursor: 'pointer',
                                                            fontWeight: 600
                                                        }}
                                                        title="Click to toggle default BOM status"
                                                    >
                                                        {b.is_default ? '★ Default' : '☆ Set Default'}
                                                    </button>
                                                </td>
                                                <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                                                    <span className={`badge ${b.is_active ? 'success' : 'danger'}`} style={{ fontSize: '0.75rem' }}>
                                                        {b.is_active ? 'Active' : 'Inactive'}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                                    <button 
                                                        className="btn"
                                                        onClick={() => handleInspect(b.name)}
                                                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', border: 'none', borderRadius: '4px' }}
                                                        title="Inspect full raw materials breakdown"
                                                    >
                                                        <i className="ri-eye-line"></i> Inspect
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {boms.length === 0 && (
                                            <tr>
                                                <td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                                                    No BOMs found matching search.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                    Page {page} of {Math.ceil(totalBoms / 20) || 1}
                                </span>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        className="btn"
                                        disabled={page <= 1}
                                        onClick={() => loadBoms(page - 1)}
                                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: 'rgba(255,255,255,0.06)' }}
                                    >
                                        Previous
                                    </button>
                                    <button
                                        className="btn"
                                        disabled={page >= Math.ceil(totalBoms / 20)}
                                        onClick={() => loadBoms(page + 1)}
                                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: 'rgba(255,255,255,0.06)' }}
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* TAB 2: INSPECT BOM DETAILS */}
            {activeTab === 'inspect' && (
                <div className="card glass-panel" style={{ padding: '1.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                        <div>
                            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <i className="ri-search-eye-line text-primary"></i> 
                                BOM Breakdown & Raw Materials
                            </h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                Detailed raw materials consumption, UOMs, and item rates for this BOM in ERPNext.
                            </p>
                        </div>
                        <button 
                            className="btn"
                            onClick={() => setActiveTab('display')}
                            style={{ background: 'rgba(255, 255, 255, 0.08)', fontSize: '0.85rem' }}
                        >
                            <i className="ri-arrow-left-line"></i> Back to Directory
                        </button>
                    </div>

                    {/* Lookup input bar */}
                    <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', maxWidth: '600px' }}>
                        <input
                            type="text"
                            placeholder="Enter BOM ID (e.g. BOM-NARA-MEN-KUR-M-001)..."
                            value={inspectBomId}
                            onChange={(e) => setInspectBomId(e.target.value)}
                            style={{
                                flex: 1,
                                padding: '0.65rem 0.85rem',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '6px',
                                color: '#fff'
                            }}
                        />
                        <button
                            onClick={() => handleInspect(inspectBomId.trim())}
                            disabled={inspectLoading || !inspectBomId.trim()}
                            className="btn btn-primary"
                        >
                            <i className={inspectLoading ? "ri-loader-4-line spin" : "ri-search-line"}></i>
                            Lookup
                        </button>
                    </div>

                    {inspectError && (
                        <div style={{ padding: '1rem', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', marginBottom: '1rem' }}>
                            {inspectError}
                        </div>
                    )}

                    {selectedBomDetails && selectedBomDetails.bom && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {/* BOM Header Card */}
                            <div style={{ 
                                background: 'rgba(255, 255, 255, 0.03)', 
                                padding: '1.25rem', 
                                borderRadius: '8px', 
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                gap: '1rem'
                            }}>
                                <div>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>BOM Document ID</span>
                                    <strong style={{ fontSize: '1rem', color: '#34d399', fontFamily: 'monospace' }}>
                                        {selectedBomDetails.bom.name}
                                    </strong>
                                </div>
                                <div>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Manufactured Item</span>
                                    <strong style={{ fontSize: '0.95rem', color: '#38bdf8' }}>
                                        {selectedBomDetails.bom.item}
                                    </strong>
                                    <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>{selectedBomDetails.bom.item_name}</div>
                                </div>
                                <div>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Manufacturing Output Qty</span>
                                    <strong style={{ fontSize: '1.1rem', color: '#f8fafc' }}>
                                        {selectedBomDetails.bom.quantity} {selectedBomDetails.bom.uom || 'Nos'}
                                    </strong>
                                </div>
                                <div>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Total BOM Cost</span>
                                    <strong style={{ fontSize: '1.1rem', color: '#f59e0b' }}>
                                        {selectedBomDetails.bom.total_cost ? `₹${parseFloat(selectedBomDetails.bom.total_cost).toFixed(2)}` : '₹0.00'}
                                    </strong>
                                </div>
                                <div>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>BOM Flags</span>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.2rem' }}>
                                        <span className={`badge ${selectedBomDetails.bom.is_default ? 'success' : 'warning'}`}>
                                            {selectedBomDetails.bom.is_default ? 'Default BOM' : 'Secondary BOM'}
                                        </span>
                                        <span className={`badge ${selectedBomDetails.bom.is_active ? 'success' : 'danger'}`}>
                                            {selectedBomDetails.bom.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Raw Materials Items Breakdown Table */}
                            <div>
                                <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem' }}>
                                    Component Raw Materials ({selectedBomDetails.bom.items ? selectedBomDetails.bom.items.length : 0} items)
                                </h4>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--text-muted)' }}>
                                                <th style={{ padding: '0.65rem' }}>#</th>
                                                <th style={{ padding: '0.65rem' }}>Raw Material Code</th>
                                                <th style={{ padding: '0.65rem' }}>Raw Material Name</th>
                                                <th style={{ padding: '0.65rem' }}>Required Qty</th>
                                                <th style={{ padding: '0.65rem' }}>UOM</th>
                                                <th style={{ padding: '0.65rem' }}>Unit Rate</th>
                                                <th style={{ padding: '0.65rem' }}>Total Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedBomDetails.bom.items && selectedBomDetails.bom.items.map((it, idx) => (
                                                <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                                                    <td style={{ padding: '0.65rem', color: 'var(--text-muted)' }}>{idx + 1}</td>
                                                    <td style={{ padding: '0.65rem', fontFamily: 'monospace', color: '#cbd5e1' }}>
                                                        <span style={{ background: 'rgba(255,255,255,0.05)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                                                            {it.item_code}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '0.65rem', fontWeight: 500, color: '#f8fafc' }}>
                                                        {it.item_name || it.item_code}
                                                    </td>
                                                    <td style={{ padding: '0.65rem', color: '#34d399', fontWeight: 600 }}>
                                                        {it.qty}
                                                    </td>
                                                    <td style={{ padding: '0.65rem', color: 'var(--text-muted)' }}>
                                                        {it.uom || it.stock_uom}
                                                    </td>
                                                    <td style={{ padding: '0.65rem', color: 'var(--text-muted)' }}>
                                                        ₹{it.rate ? parseFloat(it.rate).toFixed(2) : '0.00'}
                                                    </td>
                                                    <td style={{ padding: '0.65rem', color: '#f8fafc', fontWeight: 600 }}>
                                                        ₹{it.amount ? parseFloat(it.amount).toFixed(2) : '0.00'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB 3: CREATE NEW BOM */}
            {activeTab === 'create' && (
                <div className="card glass-panel" style={{ padding: '2rem', maxWidth: '750px' }}>
                    <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <i className="ri-add-box-line text-primary"></i> 
                        Create Bill of Materials in ERPNext
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                        Directly registers an official BOM in ERPNext. By default, automatically builds component lines using the maintained <strong>Recipe Master</strong>.
                    </p>

                    <form onSubmit={handleCreateBom} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        <div>
                            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                                Manufactured Item (Finished Good) *
                            </label>
                            <input
                                type="text"
                                list="bom_erp_items"
                                placeholder="Select or enter Item Code (e.g. NARA-MEN-KUR-M, 46784899088598)..."
                                value={createForm.item_code}
                                onChange={(e) => setCreateForm({ ...createForm, item_code: e.target.value })}
                                style={{
                                    width: '100%',
                                    padding: '0.75rem 1rem',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '6px',
                                    color: '#fff'
                                }}
                            />
                            <datalist id="bom_erp_items">
                                {erpItems.map(it => (
                                    <option key={it.name} value={it.name}>
                                        {it.item_name} ({it.name})
                                    </option>
                                ))}
                            </datalist>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                                    Output Quantity (Demand Qty) *
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={createForm.quantity}
                                    onChange={(e) => setCreateForm({ ...createForm, quantity: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem 1rem',
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '6px',
                                        color: '#fff'
                                    }}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.5rem', paddingTop: '1.25rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', color: '#cbd5e1' }}>
                                    <input
                                        type="checkbox"
                                        checked={createForm.use_recipe_master}
                                        onChange={(e) => setCreateForm({ ...createForm, use_recipe_master: e.target.checked })}
                                        style={{ width: '16px', height: '16px', accentColor: '#6366f1' }}
                                    />
                                    <span>Pull Components from Recipe Master</span>
                                </label>

                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', color: '#cbd5e1' }}>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(createForm.is_default)}
                                        onChange={(e) => setCreateForm({ ...createForm, is_default: e.target.checked ? 1 : 0 })}
                                        style={{ width: '16px', height: '16px', accentColor: '#6366f1' }}
                                    />
                                    <span>Set as Default BOM in Item Master</span>
                                </label>
                            </div>
                        </div>

                        <div>
                            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                                Description / Notes
                            </label>
                            <input
                                type="text"
                                placeholder="Optional description or note..."
                                value={createForm.description}
                                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                                style={{
                                    width: '100%',
                                    padding: '0.75rem 1rem',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '6px',
                                    color: '#fff'
                                }}
                            />
                        </div>

                        {createFeedback && (
                            <div style={{
                                padding: '0.75rem 1rem',
                                borderRadius: '6px',
                                fontSize: '0.85rem',
                                backgroundColor: createFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                color: createFeedback.type === 'success' ? '#22c55e' : '#ef4444'
                            }}>
                                {createFeedback.message}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                            <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={createLoading}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                            >
                                <i className={createLoading ? "ri-loader-4-line spin" : "ri-send-plane-line"}></i>
                                {createLoading ? "Creating BOM in ERPNext..." : "Create BOM"}
                            </button>
                            <button
                                type="button"
                                className="btn"
                                onClick={() => setActiveTab('display')}
                                style={{ background: 'rgba(255,255,255,0.06)' }}
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

        </div>
    );
};

export default BomMaster;
