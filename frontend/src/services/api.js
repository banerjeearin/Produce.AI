const BASE_URL = 'http://localhost:8000/api';

export const fetchStats = async (dateFrom, dateTo) => {
    const params = new URLSearchParams();
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${BASE_URL}/dashboard/stats${query}`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
};

export const fetchExceptions = async () => {
    const res = await fetch(`${BASE_URL}/dashboard/exceptions`);
    if (!res.ok) throw new Error('Failed to fetch exceptions');
    return res.json();
};

export const resolveException = async (exceptionId) => {
    const res = await fetch(`${BASE_URL}/dashboard/exceptions/${exceptionId}/resolve`, {
        method: 'POST'
    });
    if (!res.ok) throw new Error('Failed to resolve exception');
    return res.json();
};

export const runPipeline = async (dateFrom, dateTo) => {
    const res = await fetch(`${BASE_URL}/pipeline/run`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            date_from: dateFrom || null,
            date_to: dateTo || null
        })
    });
    if (!res.ok) throw new Error('Failed to run pipeline');
    return res.json();
};

export const getActivities = async (limit = 100, dateFrom, dateTo) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit);
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${BASE_URL}/dashboard/activities${query}`);
    if (!res.ok) throw new Error('Failed to fetch activities');
    return res.json();
};

export const deleteRunData = async (runId) => {
    const res = await fetch(`${BASE_URL}/pipeline/runs/${runId}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Failed to delete data for run ${runId}`);
    return res.json();
};

export const getInventoryReport = async (dateStr) => {
    const query = dateStr ? `?date=${encodeURIComponent(dateStr)}` : '';
    const res = await fetch(`${BASE_URL}/dashboard/inventory${query}`);
    if (!res.ok) throw new Error('Failed to fetch inventory report');
    return res.json();
};

export const getRunState = async (runId) => {
    const res = await fetch(`${BASE_URL}/pipeline/runs/${runId}/state`);
    if (!res.ok) throw new Error(`Failed to fetch state for run ${runId}`);
    return res.json();
};

export const resumeRun = async (runId) => {
    const res = await fetch(`${BASE_URL}/pipeline/runs/${runId}/resume`, {
        method: 'POST',
    });
    if (!res.ok) throw new Error(`Failed to resume run ${runId}`);
    return res.json();
};

export const autoRunPipeline = async (runId) => {
    const res = await fetch(`${BASE_URL}/pipeline/runs/${runId}/auto-run`, {
        method: 'POST',
    });
    if (!res.ok) throw new Error(`Failed to auto-run pipeline ${runId}`);
    return res.json();
};

export const massAutoRunPipelines = async (runIds) => {
    const res = await fetch(`${BASE_URL}/pipeline/runs/mass-auto-run`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ run_ids: runIds })
    });
    if (!res.ok) throw new Error('Failed to start mass auto-processing');
    return res.json();
};

export const getErpItems = async () => {
    const res = await fetch(`${BASE_URL}/pipeline/erp-items`);
    if (!res.ok) throw new Error('Failed to fetch ERPNext items');
    return res.json();
};

export const updateSkuMapping = async (shopifySku, erpItemCode, runId) => {
    const res = await fetch(`${BASE_URL}/pipeline/mapping/update`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            shopify_sku: shopifySku,
            erp_item_code: erpItemCode,
            run_id: runId || null
        })
    });
    if (!res.ok) throw new Error('Failed to update SKU mapping');
    return res.json();
};

export const fetchBomSummary = async (dateFrom, dateTo) => {
    const params = new URLSearchParams();
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${BASE_URL}/pipeline/bom-summary${query}`);
    if (!res.ok) throw new Error('Failed to fetch BOM summary');
    return res.json();
};

export const getMaterialMasterStatus = async (identifier) => {
    const res = await fetch(`${BASE_URL}/material-master/status/${encodeURIComponent(identifier)}`);
    if (!res.ok) throw new Error('Failed to fetch item status');
    return res.json();
};

export const previewMaterialMasters = async (items) => {
    const res = await fetch(`${BASE_URL}/material-master/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus_or_items: items })
    });
    if (!res.ok) throw new Error('Failed to preview items');
    return res.json();
};

export const createMaterialMaster = async (payload) => {
    const res = await fetch(`${BASE_URL}/material-master/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to create material master');
    }
    return res.json();
};

export const syncMaterialMasterDryRun = async (onlyProduct = null) => {
    const query = onlyProduct ? `?only=${encodeURIComponent(onlyProduct)}` : '';
    const res = await fetch(`${BASE_URL}/material-master/sync/dry-run${query}`, {
        method: 'POST'
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Dry run failed');
    }
    return res.json();
};

export const syncMaterialMasterApply = async (onlyProduct = null, backfill = false) => {
    const params = new URLSearchParams();
    if (onlyProduct) params.append('only', onlyProduct);
    if (backfill) params.append('backfill', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${BASE_URL}/material-master/sync/apply${query}`, {
        method: 'POST'
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Sync execution failed');
    }
    return res.json();
};

export const getItemGroups = async () => {
    return { item_groups: ["Products", "Raw Material", "Sub Assemblies", "Consumables"] };
};
