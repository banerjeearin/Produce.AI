const BASE_URL = 'http://localhost:8000/api';

export const fetchStats = async () => {
    const res = await fetch(`${BASE_URL}/dashboard/stats`);
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

export const getActivities = async (limit = 15) => {
    const res = await fetch(`${BASE_URL}/dashboard/activities?limit=${limit}`);
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
