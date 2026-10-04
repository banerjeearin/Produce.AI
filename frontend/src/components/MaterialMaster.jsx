import React, { useState, useEffect } from 'react';
import { 
    getMaterialMasterStatus, 
    createMaterialMaster, 
    getItemGroups, 
    getErpItems,
    syncMaterialMasterDryRun,
    syncMaterialMasterApply
} from '../services/api';

const MaterialMaster = () => {
    // Mode: 'lookup' or 'create'
    const [lookupQuery, setLookupQuery] = useState('');
    const [lookupResult, setLookupResult] = useState(null);
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [lookupError, setLookupError] = useState(null);

    // Form fields for standalone creation
    const [formData, setFormData] = useState({
        item_code: '',
        item_name: '',
        item_group: 'Products',
        stock_uom: 'Nos',
        is_stock_item: 1,
        is_sales_item: 1,
        include_item_in_manufacturing: 1,
        shopify_sku: ''
    });

    const [itemGroups, setItemGroups] = useState(['Products', 'Raw Material', 'Sub Assemblies']);
    const [createLoading, setCreateLoading] = useState(false);
    const [createFeedback, setCreateFeedback] = useState(null);

    // Script Sync State
    const [syncOnlyProduct, setSyncOnlyProduct] = useState('');
    const [syncBackfill, setSyncBackfill] = useState(false);
    const [syncLoading, setSyncLoading] = useState(false);
    const [syncResult, setSyncResult] = useState(null);
    const [syncError, setSyncError] = useState(null);

    const handleSyncDryRun = async () => {
        setSyncLoading(true);
        setSyncError(null);
        setSyncResult(null);
        try {
            const res = await syncMaterialMasterDryRun(syncOnlyProduct.trim() || null);
            setSyncResult(res);
        } catch (e) {
            setSyncError(e.message);
        } finally {
            setSyncLoading(false);
        }
    };

    const handleSyncApply = async () => {
        if (!window.confirm("Are you sure you want to create and apply templates and variants to ERPNext?")) {
            return;
        }
        setSyncLoading(true);
        setSyncError(null);
        setSyncResult(null);
        try {
            const res = await syncMaterialMasterApply(syncOnlyProduct.trim() || null, syncBackfill);
            setSyncResult(res);
        } catch (e) {
            setSyncError(e.message);
        } finally {
            setSyncLoading(false);
        }
    };

    const handleLookup = async (e) => {
        e.preventDefault();
        if (!lookupQuery.trim()) return;
        setIsLookingUp(true);
        setLookupError(null);
        setLookupResult(null);

        try {
            const res = await getMaterialMasterStatus(lookupQuery.trim());
            setLookupResult(res);
        } catch (err) {
            setLookupError(err.message || 'Error checking item in ERPNext');
        } finally {
            setIsLookingUp(false);
        }
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!formData.item_code.trim()) {
            setCreateFeedback({ type: 'error', message: 'Item Code is required' });
            return;
        }

        setCreateLoading(true);
        setCreateFeedback(null);

        try {
            const res = await createMaterialMaster({
                ...formData,
                item_code: formData.item_code.trim(),
                item_name: (formData.item_name || formData.item_code).trim(),
                shopify_sku: formData.shopify_sku.trim() || undefined
            });
            setCreateFeedback({
                type: 'success',
                message: res.message || 'Material Master created successfully!'
            });
            // Reset form
            setFormData({
                item_code: '',
                item_name: '',
                item_group: 'Products',
                stock_uom: 'Nos',
                is_stock_item: 1,
                is_sales_item: 1,
                include_item_in_manufacturing: 1,
                shopify_sku: ''
            });
        } catch (err) {
            setCreateFeedback({
                type: 'error',
                message: err.message || 'Failed to create Material Master'
            });
        } finally {
            setCreateLoading(false);
        }
    };

    return (
        <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Header Banner */}
            <div className="card glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #6366f1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ fontSize: '1.35rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <i className="ri-database-2-line" style={{ color: '#818cf8' }}></i>
                            Standalone Material Master Node
                        </h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                            Completely isolated process for validating and creating Raw Materials or Finished Goods in ERPNext. Does NOT run within the automated order pipeline.
                        </p>
                    </div>
                    <span className="badge" style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', padding: '0.5rem 1rem', borderRadius: '20px' }}>
                        Independent Node
                    </span>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' }}>
                
                {/* 1. Safe Lookup & Verification (Read-Only) */}
                <div className="card glass-panel" style={{ padding: '1.75rem' }}>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <i className="ri-search-eye-line text-primary"></i> 
                        Inspect Material Master (Read-Only)
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                        Safely verify whether an Item Code or Shopify SKU exists in ERPNext without modifying data or running pipelines.
                    </p>

                    <form onSubmit={handleLookup} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
                        <input
                            type="text"
                            placeholder="Enter Item Code or Shopify SKU (e.g. STO-ITEM-2025-00021)..."
                            value={lookupQuery}
                            onChange={(e) => setLookupQuery(e.target.value)}
                            style={{
                                flex: 1,
                                padding: '0.75rem 1rem',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '8px',
                                color: '#fff',
                                outline: 'none'
                            }}
                        />
                        <button 
                            type="submit" 
                            className="btn btn-primary"
                            disabled={isLookingUp}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            <i className={isLookingUp ? "ri-loader-4-line ri-spin" : "ri-search-line"}></i>
                            {isLookingUp ? "Checking..." : "Inspect"}
                        </button>
                    </form>

                    {lookupError && (
                        <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontSize: '0.875rem' }}>
                            <i className="ri-error-warning-line" style={{ marginRight: '0.5rem' }}></i>
                            {lookupError}
                        </div>
                    )}

                    {lookupResult && (
                        <div style={{
                            padding: '1.25rem',
                            borderRadius: '8px',
                            backgroundColor: lookupResult.exists_in_erp ? 'rgba(34, 197, 94, 0.08)' : 'rgba(234, 179, 8, 0.08)',
                            border: `1px solid ${lookupResult.exists_in_erp ? 'rgba(34, 197, 94, 0.25)' : 'rgba(234, 179, 8, 0.25)'}`
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Query: {lookupResult.query}</span>
                                <span className={`badge ${lookupResult.exists_in_erp ? 'success' : 'warning'}`} style={{ padding: '0.25rem 0.6rem' }}>
                                    {lookupResult.exists_in_erp ? 'EXISTS IN ERPNEXT' : 'NOT FOUND IN ERPNEXT'}
                                </span>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
                                <div>
                                    <span style={{ color: 'var(--text-muted)' }}>ERP Item Code: </span>
                                    <strong style={{ color: '#fff' }}>{lookupResult.erp_item_code || 'None'}</strong>
                                </div>
                                <div>
                                    <span style={{ color: 'var(--text-muted)' }}>Item Name: </span>
                                    <span style={{ color: '#fff' }}>{lookupResult.erp_item_name || 'N/A'}</span>
                                </div>
                                <div>
                                    <span style={{ color: 'var(--text-muted)' }}>Item Group: </span>
                                    <span style={{ color: '#fff' }}>{lookupResult.item_group || 'N/A'}</span>
                                </div>
                                <div>
                                    <span style={{ color: 'var(--text-muted)' }}>Stock UOM: </span>
                                    <span style={{ color: '#fff' }}>{lookupResult.stock_uom || 'N/A'}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* 2. Manual Material Master Creator (Explicit User Execution) */}
                <div className="card glass-panel" style={{ padding: '1.75rem' }}>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <i className="ri-add-box-line text-primary"></i> 
                        Create Material Master in ERPNext
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                        Directly registers a new Material Master item in ERPNext when explicitly submitted here.
                    </p>

                    <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                                    Item Code *
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. STO-ITEM-FABRIC-01"
                                    value={formData.item_code}
                                    onChange={(e) => setFormData({ ...formData, item_code: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '0.65rem 0.85rem',
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '6px',
                                        color: '#fff'
                                    }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                                    Item Name
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. Organic Cotton Twill"
                                    value={formData.item_name}
                                    onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '0.65rem 0.85rem',
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '6px',
                                        color: '#fff'
                                    }}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                                    Item Group
                                </label>
                                <select
                                    value={formData.item_group}
                                    onChange={(e) => setFormData({ ...formData, item_group: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '0.65rem 0.85rem',
                                        background: '#1e293b',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '6px',
                                        color: '#fff'
                                    }}
                                >
                                    {itemGroups.map(grp => (
                                        <option key={grp} value={grp}>{grp}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                                    Stock UOM
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. Nos, Meter, Kg"
                                    value={formData.stock_uom}
                                    onChange={(e) => setFormData({ ...formData, stock_uom: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '0.65rem 0.85rem',
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '6px',
                                        color: '#fff'
                                    }}
                                />
                            </div>
                        </div>

                        <div>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                                Optional: Associate with Shopify SKU
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. Midnight Picnic Maxi Skirt_XS"
                                value={formData.shopify_sku}
                                onChange={(e) => setFormData({ ...formData, shopify_sku: e.target.value })}
                                style={{
                                    width: '100%',
                                    padding: '0.65rem 0.85rem',
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

                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={createLoading}
                            style={{ marginTop: '0.5rem', alignSelf: 'flex-start' }}
                        >
                            <i className={createLoading ? "ri-loader-4-line ri-spin" : "ri-send-plane-line"} style={{ marginRight: '0.4rem' }}></i>
                            {createLoading ? "Submitting to ERPNext..." : "Create Material Master"}
                        </button>
                    </form>
                </div>
            </div>

            {/* 3. Batch Shopify Catalogue -> ERPNext Templates & Variants Sync */}
            <div className="card glass-panel" style={{ padding: '1.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                    <div>
                        <h3 style={{ fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <i className="ri-refresh-line text-primary"></i> 
                            Catalogue Item Templates & Variants Builder
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            Reads Shopify catalogue via Admin GraphQL, builds parent Item Templates and child size variants (XS, S, M, L, XL, etc.) with custom fields in ERPNext.
                        </p>
                    </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem' }}>
                    <div style={{ flex: '1 1 300px' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                            Filter Single Product (Leave empty to process all active/draft products)
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. Sitara Top, June Tube Top with Scarf..."
                            value={syncOnlyProduct}
                            onChange={(e) => setSyncOnlyProduct(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '0.65rem 0.85rem',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '6px',
                                color: '#fff'
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.25rem' }}>
                        <input
                            type="checkbox"
                            id="backfill_checkbox"
                            checked={syncBackfill}
                            onChange={(e) => setSyncBackfill(e.target.checked)}
                            style={{ width: '16px', height: '16px', accentColor: '#6366f1' }}
                        />
                        <label htmlFor="backfill_checkbox" style={{ fontSize: '0.85rem', color: '#cbd5e1', cursor: 'pointer' }}>
                            Backfill Shopify IDs on existing exact-match items
                        </label>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                    <button
                        type="button"
                        className="btn"
                        onClick={handleSyncDryRun}
                        disabled={syncLoading}
                        style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.08)',
                            color: '#e2e8f0',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}
                    >
                        <i className={syncLoading ? "ri-loader-4-line ri-spin" : "ri-eye-line"}></i>
                        Run Dry Run (Simulate Plan)
                    </button>

                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleSyncApply}
                        disabled={syncLoading}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                        <i className={syncLoading ? "ri-loader-4-line ri-spin" : "ri-play-circle-line"}></i>
                        Apply & Create in ERPNext
                    </button>
                </div>

                {syncError && (
                    <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontSize: '0.875rem', marginBottom: '1rem' }}>
                        <i className="ri-error-warning-line" style={{ marginRight: '0.5rem' }}></i>
                        {syncError}
                    </div>
                )}

                {syncResult && (
                    <div style={{
                        padding: '1.25rem',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                                Sync Execution {syncResult.is_dry_run ? '(Dry Run Simulation)' : '(Applied to ERPNext)'}
                            </span>
                            <span className={`badge ${syncResult.is_dry_run ? 'warning' : 'success'}`} style={{ padding: '0.25rem 0.6rem' }}>
                                {syncResult.is_dry_run ? 'DRY RUN' : 'APPLIED'}
                            </span>
                        </div>

                        {/* Stats counters */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
                            {Object.entries(syncResult.stats || {}).map(([key, val]) => (
                                <div key={key} style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '0.5rem 0.85rem', borderRadius: '6px', fontSize: '0.85rem' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>{key}: </span>
                                    <strong style={{ color: '#fff' }}>{val}</strong>
                                </div>
                            ))}
                        </div>

                        {/* Plan details sample */}
                        {syncResult.plan_details && syncResult.plan_details.length > 0 && (
                            <div>
                                <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                                    Action Plan Details ({syncResult.plan_details.length} actions):
                                </h4>
                                <div style={{
                                    maxHeight: '220px',
                                    overflowY: 'auto',
                                    fontFamily: 'monospace',
                                    fontSize: '0.8rem',
                                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                    padding: '0.75rem',
                                    borderRadius: '6px',
                                    color: '#94a3b8'
                                }}>
                                    {syncResult.plan_details.map((d, i) => (
                                        <div key={i} style={{ marginBottom: '0.2rem' }}>{d}</div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MaterialMaster;
