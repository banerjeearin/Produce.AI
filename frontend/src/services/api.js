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
