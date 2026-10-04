import React, { useState, useEffect } from 'react';
import { 
    getRecipeList, 
    getRecipeByFg, 
    createRecipe, 
    updateRecipe, 
    deleteRecipe,
    getRecipeRawMaterials
} from '../services/api';

const RecipeMaster = () => {
    // Mode: 'display', 'create', 'change', 'inventory'
    const [activeTab, setActiveTab] = useState('display');

    // Display / List State
    const [recipes, setRecipes] = useState([]);
    const [totalRecipes, setTotalRecipes] = useState(0);
    const [page, setPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const [listLoading, setListLoading] = useState(false);
    const [listError, setListError] = useState(null);

    // FG Lookup State (Inspect single FG recipes)
    const [lookupFg, setLookupFg] = useState('');
    const [lookupResult, setLookupResult] = useState(null);
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [lookupError, setLookupError] = useState(null);

    // Available Raw Materials with live stock balances
    const [rawMaterials, setRawMaterials] = useState([]);
    const [rmFilter, setRmFilter] = useState('');
    const [rmLoading, setRmLoading] = useState(false);

    // Create Form State
    const [createForm, setCreateForm] = useState({
        fg_item_code: '',
        raw_material_code: 'STO-ITEM-2025-00021',
        qty: 1.5,
        uom: 'Meter'
    });
    const [createLoading, setCreateLoading] = useState(false);
    const [createFeedback, setCreateFeedback] = useState(null);

    // Change / Edit Form State
    const [editingRecipe, setEditingRecipe] = useState(null);
    const [changeLoading, setChangeLoading] = useState(false);
    const [changeFeedback, setChangeFeedback] = useState(null);

    // Fetch all Raw Materials with current inventory balances
    const fetchRms = async () => {
        setRmLoading(true);
        try {
            const res = await getRecipeRawMaterials(false);
            if (res && res.raw_materials) {
                setRawMaterials(res.raw_materials);
            }
        } catch (e) {
            console.error("Could not fetch raw materials", e);
        } finally {
            setRmLoading(false);
        }
    };

    useEffect(() => {
        fetchRms();
    }, []);

    // Load paginated list of recipes
    const loadRecipes = async (p = 1, search = searchQuery) => {
        setListLoading(true);
        setListError(null);
        try {
            const data = await getRecipeList(search, p, 20);
            setRecipes(data.items || []);
            setTotalRecipes(data.total || 0);
            setPage(data.page || 1);
        } catch (err) {
            setListError(err.message || 'Failed to load Recipe Master items');
        } finally {
            setListLoading(false);
        }
    };

    useEffect(() => {
        loadRecipes(1, searchQuery);
    }, [searchQuery]);

    // Lookup single FG recipes
    const handleFgLookup = async (e) => {
        e.preventDefault();
        if (!lookupFg.trim()) return;
        setIsLookingUp(true);
        setLookupError(null);
        setLookupResult(null);

        try {
            const res = await getRecipeByFg(lookupFg.trim());
            setLookupResult(res);
        } catch (err) {
            setLookupError(err.message || 'Failed to lookup recipe for FG');
        } finally {
            setIsLookingUp(false);
        }
    };

    // Handle Create
    const handleCreate = async (e) => {
        e.preventDefault();
        if (!createForm.fg_item_code.trim()) {
            setCreateFeedback({ type: 'error', message: 'Finished Good item code is required.' });
            return;
        }
        if (!createForm.raw_material_code.trim()) {
            setCreateFeedback({ type: 'error', message: 'Raw material code is required.' });
            return;
        }
        if (!createForm.qty || Number(createForm.qty) <= 0) {
            setCreateFeedback({ type: 'error', message: 'Quantity must be greater than 0.' });
            return;
        }

        setCreateLoading(true);
        setCreateFeedback(null);

        try {
            const res = await createRecipe({
                fg_item_code: createForm.fg_item_code.trim(),
                raw_material_code: createForm.raw_material_code.trim(),
                qty: parseFloat(createForm.qty),
                uom: createForm.uom.trim() || 'Meter'
            });
            setCreateFeedback({
                type: 'success',
                message: res.message || 'Recipe created successfully!'
            });
            setCreateForm({
                fg_item_code: '',
                raw_material_code: createForm.raw_material_code,
                qty: 1.5,
                uom: 'Meter'
            });
            loadRecipes(1);
        } catch (err) {
            setCreateFeedback({
                type: 'error',
                message: err.message || 'Failed to create recipe.'
            });
        } finally {
            setCreateLoading(false);
        }
    };

    // Quick select a raw material from inventory list to use in recipe creation
    const selectRmForNewRecipe = (rm) => {
        setCreateForm({
            ...createForm,
            raw_material_code: rm.item_code,
            uom: rm.stock_uom || 'Meter'
        });
        setActiveTab('create');
    };

    // Initiate Change / Edit
    const startEditing = (recipe) => {
        setEditingRecipe({
            id: recipe.id,
            fg_item_code: recipe.fg_item_code,
            raw_material_code: recipe.raw_material_code,
            raw_material_name: recipe.raw_material_name,
            qty: recipe.qty,
            uom: recipe.uom
        });
        setChangeFeedback(null);
        setActiveTab('change');
    };

    // Handle Update / Change
    const handleUpdate = async (e) => {
        e.preventDefault();
        if (!editingRecipe) return;

        setChangeLoading(true);
        setChangeFeedback(null);

        try {
            const res = await updateRecipe(editingRecipe.id, {
                raw_material_code: editingRecipe.raw_material_code.trim(),
                qty: parseFloat(editingRecipe.qty),
                uom: editingRecipe.uom.trim()
            });
            setChangeFeedback({
                type: 'success',
                message: res.message || 'Recipe updated successfully!'
            });
            loadRecipes(page);
        } catch (err) {
            setChangeFeedback({
                type: 'error',
                message: err.message || 'Failed to update recipe.'
            });
        } finally {
            setChangeLoading(false);
        }
    };

    // Handle Delete
    const handleDelete = async (recipeId) => {
        if (!window.confirm(`Are you sure you want to delete recipe line #${recipeId}?`)) {
            return;
        }
        try {
            await deleteRecipe(recipeId);
            if (editingRecipe && editingRecipe.id === recipeId) {
                setEditingRecipe(null);
            }
            loadRecipes(page);
        } catch (err) {
            alert(err.message || 'Failed to delete recipe');
        }
    };

    const inStockRms = rawMaterials.filter(rm => (rm.bal_qty || 0) > 0);
    const zeroStockRms = rawMaterials.filter(rm => (rm.bal_qty || 0) <= 0);

    const filteredInStockRms = inStockRms.filter(rm => 
        !rmFilter || 
        rm.item_code.toLowerCase().includes(rmFilter.toLowerCase()) || 
        (rm.item_name && rm.item_name.toLowerCase().includes(rmFilter.toLowerCase()))
    );

    return (
        <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Header Banner */}
            <div className="card glass-panel" style={{ padding: '1.5rem', borderLeft: '4px solid #10b981' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ fontSize: '1.35rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <i className="ri-flask-line" style={{ color: '#34d399' }}></i>
                            Recipe Master Node (BOM Recipes)
                        </h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                            Master Bill-of-Materials registry with material names, real-time ERP inventory levels, and available fabric alternatives.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <button
                            onClick={() => {
                                fetchRms();
                                loadRecipes(page);
                            }}
                            disabled={rmLoading || listLoading}
                            style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                color: '#e2e8f0',
                                border: '1px solid rgba(255, 255, 255, 0.15)',
                                padding: '0.45rem 0.85rem',
                                borderRadius: '8px',
                                cursor: (rmLoading || listLoading) ? 'not-allowed' : 'pointer',
                                fontWeight: '600',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                fontSize: '0.82rem',
                                transition: 'all 0.2s ease'
                            }}
                            title="Recheck ERP inventory balances and reload recipe master"
                        >
                            <i className={(rmLoading || listLoading) ? "ri-loader-4-line spin" : "ri-refresh-line"}></i>
                            <span>{(rmLoading || listLoading) ? 'Updating...' : 'Refresh Status'}</span>
                        </button>
                        <span className="badge" style={{ backgroundColor: 'rgba(16, 185, 129, 0.2)', color: '#34d399', padding: '0.5rem 0.85rem', borderRadius: '20px' }}>
                            {inStockRms.length} Raw Materials In Stock
                        </span>
                        <span className="badge" style={{ backgroundColor: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', padding: '0.5rem 0.85rem', borderRadius: '20px' }}>
                            {totalRecipes} Recipes Configured
                        </span>
                    </div>
                </div>
            </div>

            {/* Sub-Navigation Tabs: Display, In-Stock Raw Materials, Create, Change */}
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
                        gap: '0.5rem',
                        transition: 'all 0.2s ease'
                    }}
                >
                    <i className="ri-list-check"></i>
                    Display Recipes
                </button>

                <button
                    onClick={() => setActiveTab('inventory')}
                    style={{
                        padding: '0.6rem 1.25rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: activeTab === 'inventory' ? 'var(--primary-color)' : 'transparent',
                        color: activeTab === 'inventory' ? '#fff' : 'var(--text-muted)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        transition: 'all 0.2s ease'
                    }}
                >
                    <i className="ri-stack-line"></i>
                    Available RM Inventory ({inStockRms.length})
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
                        gap: '0.5rem',
                        transition: 'all 0.2s ease'
                    }}
                >
                    <i className="ri-add-line"></i>
                    Create Recipe
                </button>

                <button
                    onClick={() => setActiveTab('change')}
                    style={{
                        padding: '0.6rem 1.25rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: activeTab === 'change' ? 'var(--primary-color)' : 'transparent',
                        color: activeTab === 'change' ? '#fff' : 'var(--text-muted)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        transition: 'all 0.2s ease'
                    }}
                >
                    <i className="ri-edit-line"></i>
                    Change Recipe {editingRecipe && `(#${editingRecipe.id})`}
                </button>
            </div>

            {/* TAB 1: DISPLAY / DIRECTORY */}
            {activeTab === 'display' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    
                    {/* Finished Good Single Inspection */}
                    <div className="card glass-panel" style={{ padding: '1.5rem' }}>
                        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <i className="ri-search-eye-line text-primary"></i> 
                            Inspect Finished Good Recipe (Read-Only)
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                            Check the exact raw material consumption and live ERP inventory allocated to a specific SKU or Finished Good.
                        </p>

                        <form onSubmit={handleFgLookup} style={{ display: 'flex', gap: '0.75rem' }}>
                            <input
                                type="text"
                                placeholder="Enter FG SKU / Code (e.g. Ivy Tie-up Skirt_XS, 46784899121366)..."
                                value={lookupFg}
                                onChange={(e) => setLookupFg(e.target.value)}
                                style={{
                                    flex: 1,
                                    padding: '0.7rem 1rem',
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
                                {isLookingUp ? "Inspecting..." : "Inspect"}
                            </button>
                        </form>

                        {lookupError && (
                            <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontSize: '0.875rem' }}>
                                <i className="ri-error-warning-line" style={{ marginRight: '0.5rem' }}></i>
                                {lookupError}
                            </div>
                        )}

                        {lookupResult && (
                            <div style={{
                                marginTop: '1rem',
                                padding: '1.25rem',
                                borderRadius: '8px',
                                backgroundColor: lookupResult.exists ? 'rgba(34, 197, 94, 0.08)' : 'rgba(234, 179, 8, 0.08)',
                                border: `1px solid ${lookupResult.exists ? 'rgba(34, 197, 94, 0.25)' : 'rgba(234, 179, 8, 0.25)'}`
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                    <span style={{ fontWeight: 600 }}>FG Item Code: {lookupResult.fg_item_code}</span>
                                    <span className={`badge ${lookupResult.exists ? 'success' : 'warning'}`}>
                                        {lookupResult.exists ? `${lookupResult.lines.length} RECIPE LINES FOUND` : 'NO RECIPE DEFINED'}
                                    </span>
                                </div>

                                {lookupResult.lines && lookupResult.lines.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                        {lookupResult.lines.map((l) => (
                                            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.04)', padding: '0.75rem 1rem', borderRadius: '6px' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.95rem' }}>
                                                        {l.raw_material_name}
                                                    </div>
                                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.15rem' }}>
                                                        Code: <span style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>{l.raw_material_code}</span>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
                                                    <div>
                                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block' }}>Recipe Qty</span>
                                                        <strong style={{ color: '#34d399', fontSize: '0.95rem' }}>{l.qty} {l.uom}</strong>
                                                    </div>
                                                    <div>
                                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block' }}>Avail Stock</span>
                                                        <span className={`badge ${l.available_stock > 0 ? 'success' : 'danger'}`}>
                                                            {l.available_stock} {l.uom}
                                                        </span>
                                                    </div>
                                                    <button 
                                                        className="btn" 
                                                        onClick={() => startEditing({ ...l, fg_item_code: lookupResult.fg_item_code })}
                                                        style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', background: 'rgba(255,255,255,0.08)', color: '#fff' }}
                                                    >
                                                        <i className="ri-edit-line"></i> Change
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                                        No recipe lines found. You can add one using the <strong>Create Recipe</strong> tab above.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Master Recipe Table */}
                    <div className="card glass-panel" style={{ padding: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                            <div>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Master Recipe Directory</h3>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Enriched with ERP Item Name and Live Inventory Balance</p>
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    placeholder="Filter by FG SKU or Material..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    style={{
                                        padding: '0.5rem 0.85rem',
                                        background: 'rgba(255, 255, 255, 0.05)',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '6px',
                                        color: '#fff',
                                        fontSize: '0.85rem',
                                        width: '260px'
                                    }}
                                />
                                <button 
                                    className="btn btn-primary"
                                    onClick={() => setActiveTab('create')}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.85rem', fontSize: '0.85rem' }}
                                >
                                    <i className="ri-add-line"></i> New Recipe
                                </button>
                            </div>
                        </div>

                        {listLoading ? (
                            <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                <i className="ri-loader-4-line ri-spin" style={{ fontSize: '1.8rem', display: 'block', marginBottom: '0.5rem' }}></i>
                                Loading Recipe Master records...
                            </div>
                        ) : listError ? (
                            <div style={{ padding: '1rem', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                                {listError}
                            </div>
                        ) : (
                            <>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--text-muted)' }}>
                                                <th style={{ padding: '0.75rem' }}>ID</th>
                                                <th style={{ padding: '0.75rem' }}>Finished Good (SKU / Code)</th>
                                                <th style={{ padding: '0.75rem' }}>Material Code</th>
                                                <th style={{ padding: '0.75rem' }}>Material Name</th>
                                                <th style={{ padding: '0.75rem' }}>Available Stock</th>
                                                <th style={{ padding: '0.75rem' }}>Consumption</th>
                                                <th style={{ padding: '0.75rem', textAlign: 'right' }}>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {recipes.map((r) => (
                                                <tr key={r.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>#{r.id}</td>
                                                    <td style={{ padding: '0.75rem', fontWeight: 600, color: '#f8fafc' }}>
                                                        {r.fg_item_code}
                                                    </td>
                                                    <td style={{ padding: '0.75rem', color: '#cbd5e1' }}>
                                                        <span style={{ background: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                                            {r.raw_material_code}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '0.75rem', color: '#e2e8f0', fontWeight: 500 }}>
                                                        {r.raw_material_name}
                                                    </td>
                                                    <td style={{ padding: '0.75rem' }}>
                                                        <span className={`badge ${r.available_stock > 0 ? 'success' : 'danger'}`}>
                                                            {r.available_stock} {r.uom}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '0.75rem', color: '#34d399', fontWeight: 600 }}>
                                                        {r.qty} {r.uom}
                                                    </td>
                                                    <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                                        <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                                                            <button 
                                                                className="btn"
                                                                onClick={() => startEditing(r)}
                                                                style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', border: 'none', borderRadius: '4px' }}
                                                                title="Change / Edit"
                                                            >
                                                                <i className="ri-edit-line"></i> Change
                                                            </button>
                                                            <button 
                                                                className="btn"
                                                                onClick={() => handleDelete(r.id)}
                                                                style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: 'none', borderRadius: '4px' }}
                                                                title="Delete"
                                                            >
                                                                <i className="ri-delete-bin-line"></i>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                            {recipes.length === 0 && (
                                                <tr>
                                                    <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                                                        No recipes matching your search.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Pagination */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                        Page {page} of {Math.ceil(totalRecipes / 20) || 1}
                                    </span>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button
                                            className="btn"
                                            disabled={page <= 1}
                                            onClick={() => loadRecipes(page - 1)}
                                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: 'rgba(255,255,255,0.06)' }}
                                        >
                                            Previous
                                        </button>
                                        <button
                                            className="btn"
                                            disabled={page >= Math.ceil(totalRecipes / 20)}
                                            onClick={() => loadRecipes(page + 1)}
                                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: 'rgba(255,255,255,0.06)' }}
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 2: INVENTORY OF USABLE RAW MATERIALS */}
            {activeTab === 'inventory' && (
                <div className="card glass-panel" style={{ padding: '1.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                        <div>
                            <h3 style={{ fontSize: '1.15rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <i className="ri-stack-line text-primary"></i>
                                Raw Materials With Available Stock in ERPNext
                            </h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
                                These materials currently have positive inventory in Stores and can be immediately assigned as recipes to Finished Goods.
                            </p>
                        </div>
                        <input
                            type="text"
                            placeholder="Filter materials by name or code..."
                            value={rmFilter}
                            onChange={(e) => setRmFilter(e.target.value)}
                            style={{
                                padding: '0.5rem 0.85rem',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '6px',
                                color: '#fff',
                                fontSize: '0.85rem',
                                width: '280px'
                            }}
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
                        {filteredInStockRms.map((rm) => (
                            <div 
                                key={rm.item_code}
                                style={{
                                    background: 'rgba(255, 255, 255, 0.03)',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    borderRadius: '8px',
                                    padding: '1rem',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'space-between',
                                    gap: '0.75rem',
                                    transition: 'border-color 0.2s ease'
                                }}
                            >
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
                                            {rm.item_name}
                                        </h4>
                                        <span className="badge success" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
                                            In Stock
                                        </span>
                                    </div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontFamily: 'monospace', marginTop: '0.25rem' }}>
                                        {rm.item_code}
                                    </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.65rem' }}>
                                    <div>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Available Inventory</span>
                                        <strong style={{ fontSize: '1.05rem', color: '#34d399' }}>
                                            {rm.bal_qty} {rm.stock_uom}
                                        </strong>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={() => selectRmForNewRecipe(rm)}
                                        style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                                    >
                                        <i className="ri-add-line"></i> Use as Recipe
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {filteredInStockRms.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                            No raw materials found matching filter.
                        </div>
                    )}
                </div>
            )}

            {/* TAB 3: CREATE RECIPE */}
            {activeTab === 'create' && (
                <div className="card glass-panel" style={{ padding: '2rem', maxWidth: '750px' }}>
                    <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <i className="ri-add-box-line text-primary"></i> 
                        Create Recipe in Master
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                        Define raw material consumption for an SKU or Finished Good. Select from available in-stock fabrics or input any ERP item code.
                    </p>

                    <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        <div>
                            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                                Finished Good Item Code / SKU *
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. Ivy Tie-up Skirt_XS or 46784899121366"
                                value={createForm.fg_item_code}
                                onChange={(e) => setCreateForm({ ...createForm, fg_item_code: e.target.value })}
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

                        <div>
                            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                                Select Raw Material (Shows Current Available Stock) *
                            </label>
                            <select
                                value={createForm.raw_material_code}
                                onChange={(e) => {
                                    const selectedRm = rawMaterials.find(r => r.item_code === e.target.value);
                                    setCreateForm({ 
                                        ...createForm, 
                                        raw_material_code: e.target.value,
                                        uom: selectedRm ? selectedRm.stock_uom : createForm.uom
                                    });
                                }}
                                style={{
                                    width: '100%',
                                    padding: '0.75rem 1rem',
                                    background: '#1e293b',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '6px',
                                    color: '#fff'
                                }}
                            >
                                <optgroup label="In-Stock Raw Materials (Available to Produce)">
                                    {inStockRms.map((rm) => (
                                        <option key={rm.item_code} value={rm.item_code}>
                                            {rm.item_name} [{rm.item_code}] — {rm.bal_qty} {rm.stock_uom} available
                                        </option>
                                    ))}
                                </optgroup>
                                <optgroup label="Other Raw Materials (0 or Negative Stock)">
                                    {zeroStockRms.map((rm) => (
                                        <option key={rm.item_code} value={rm.item_code}>
                                            {rm.item_name} [{rm.item_code}] — {rm.bal_qty} {rm.stock_uom}
                                        </option>
                                    ))}
                                </optgroup>
                            </select>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                                    Required Quantity per FG unit *
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    placeholder="e.g. 1.50"
                                    value={createForm.qty}
                                    onChange={(e) => setCreateForm({ ...createForm, qty: e.target.value })}
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

                            <div>
                                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                                    Unit of Measure (UOM)
                                </label>
                                <input
                                    type="text"
                                    placeholder="Meter, Nos, Kg..."
                                    value={createForm.uom}
                                    onChange={(e) => setCreateForm({ ...createForm, uom: e.target.value })}
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
                                <i className={createLoading ? "ri-loader-4-line ri-spin" : "ri-check-line"}></i>
                                {createLoading ? "Saving Recipe..." : "Save Recipe"}
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

            {/* TAB 4: CHANGE / EDIT RECIPE */}
            {activeTab === 'change' && (
                <div className="card glass-panel" style={{ padding: '2rem', maxWidth: '750px' }}>
                    <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <i className="ri-edit-line text-primary"></i> 
                        Change / Edit Recipe {editingRecipe ? `(#${editingRecipe.id})` : ''}
                    </h3>
                    
                    {!editingRecipe ? (
                        <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <i className="ri-information-line" style={{ fontSize: '1.5rem', display: 'block', marginBottom: '0.5rem' }}></i>
                            No recipe selected for editing. Please select a recipe from the <strong>Display</strong> tab first.
                            <div style={{ marginTop: '1rem' }}>
                                <button className="btn btn-primary" onClick={() => setActiveTab('display')}>
                                    Go to Recipe Directory
                                </button>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            <div>
                                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                                    Finished Good (Read-Only)
                                </label>
                                <input
                                    type="text"
                                    disabled
                                    value={editingRecipe.fg_item_code}
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem 1rem',
                                        background: 'rgba(255, 255, 255, 0.02)',
                                        border: '1px solid rgba(255, 255, 255, 0.05)',
                                        borderRadius: '6px',
                                        color: '#94a3b8',
                                        cursor: 'not-allowed'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                                    Assigned Raw Material (Shows Live Stock Balance) *
                                </label>
                                <select
                                    value={editingRecipe.raw_material_code}
                                    onChange={(e) => {
                                        const selectedRm = rawMaterials.find(r => r.item_code === e.target.value);
                                        setEditingRecipe({ 
                                            ...editingRecipe, 
                                            raw_material_code: e.target.value,
                                            raw_material_name: selectedRm ? selectedRm.item_name : editingRecipe.raw_material_name,
                                            uom: selectedRm ? selectedRm.stock_uom : editingRecipe.uom
                                        });
                                    }}
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem 1rem',
                                        background: '#1e293b',
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        borderRadius: '6px',
                                        color: '#fff'
                                    }}
                                >
                                    <optgroup label="In-Stock Raw Materials">
                                        {inStockRms.map((rm) => (
                                            <option key={rm.item_code} value={rm.item_code}>
                                                {rm.item_name} [{rm.item_code}] — {rm.bal_qty} {rm.stock_uom} available
                                            </option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="Other Raw Materials (0 or Negative Stock)">
                                        {zeroStockRms.map((rm) => (
                                            <option key={rm.item_code} value={rm.item_code}>
                                                {rm.item_name} [{rm.item_code}] — {rm.bal_qty} {rm.stock_uom}
                                            </option>
                                        ))}
                                    </optgroup>
                                </select>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                                        Required Quantity *
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        value={editingRecipe.qty}
                                        onChange={(e) => setEditingRecipe({ ...editingRecipe, qty: e.target.value })}
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

                                <div>
                                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                                        Unit of Measure (UOM)
                                    </label>
                                    <input
                                        type="text"
                                        value={editingRecipe.uom}
                                        onChange={(e) => setEditingRecipe({ ...editingRecipe, uom: e.target.value })}
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
                            </div>

                            {changeFeedback && (
                                <div style={{
                                    padding: '0.75rem 1rem',
                                    borderRadius: '6px',
                                    fontSize: '0.85rem',
                                    backgroundColor: changeFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                    color: changeFeedback.type === 'success' ? '#22c55e' : '#ef4444'
                                }}>
                                    {changeFeedback.message}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={changeLoading}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                >
                                    <i className={changeLoading ? "ri-loader-4-line ri-spin" : "ri-save-line"}></i>
                                    {changeLoading ? "Saving Changes..." : "Save Changes"}
                                </button>
                                <button
                                    type="button"
                                    className="btn"
                                    onClick={() => setActiveTab('display')}
                                    style={{ background: 'rgba(255,255,255,0.06)' }}
                                >
                                    Back to Directory
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            )}

        </div>
    );
};

export default RecipeMaster;
