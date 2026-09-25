import React, { useState, useEffect } from 'react';

const Settings = () => {
  const [settingsTab, setSettingsTab] = useState('org');
  const [expandedEntity, setExpandedEntity] = useState('ent-1');
  const [orgData, setOrgData] = useState({ customer: null, entities: [] });
  const [customerName, setCustomerName] = useState('Produce.Ai Default Org');
  const [syncing, setSyncing] = useState(false);
  const [activeEntityTab, setActiveEntityTab] = useState('Details');

  // Mock data for UI demonstration
  useEffect(() => {
    setOrgData({
      customer: { id: 'cust-1', name: 'Produce.Ai' },
      entities: [
        {
          id: 'ent-1',
          company_name: 'Main Manufacturing Plant',
          company_code: 'MFG-01',
          status: 'Active',
          tan: 'TAN12345',
          pan: 'PAN98765',
          gstin: 'GSTIN001',
          financial_year: '2025-2026',
          base_currency: 'USD'
        }
      ]
    });
  }, []);

  const handleEntityChange = (entityId, field, value) => {
    setOrgData(prev => ({
      ...prev,
      entities: prev.entities.map(e => e.id === entityId ? { ...e, [field]: value } : e)
    }));
  };

  const saveCustomerName = () => {
    console.log("Customer name saved:", customerName);
  };

  const saveEntityDetails = (entityId) => {
    alert("Details saved successfully!");
  };

  const handleSyncERP = (entityId) => {
    setSyncing(true);
    setTimeout(() => {
      alert("ERP Sync Successful");
      setSyncing(false);
    }, 1500);
  };

  return (
    <div className="card glass-panel" style={{ display: "flex", height: "80vh", width: "100%", overflow: "hidden", marginTop: "2rem" }}>
      {/* Settings Sidebar */}
      <div style={{ width: "250px", borderRight: "1px solid var(--border-color)", background: "rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", padding: "24px 0", flexShrink: 0 }}>
        <div style={{ padding: "0 20px", marginBottom: "24px", color: "var(--text-muted)", fontSize: "15px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "1px" }}>Settings</div>
        
        <div className={`nav-item ${settingsTab === "org" ? "active" : ""}`} onClick={() => setSettingsTab("org")} style={{ margin: "4px 16px", cursor: "pointer", padding: "10px 16px", borderRadius: "8px", background: settingsTab === "org" ? "rgba(59, 130, 246, 0.15)" : "transparent", color: settingsTab === "org" ? "var(--accent-color)" : "var(--text-muted)" }}>
          <span style={{marginRight: '10px'}}>🏢</span> Organization
        </div>
        <div className={`nav-item ${settingsTab === "integrations" ? "active" : ""}`} onClick={() => setSettingsTab("integrations")} style={{ margin: "4px 16px", cursor: "pointer", padding: "10px 16px", borderRadius: "8px", color: settingsTab === "integrations" ? "var(--accent-color)" : "var(--text-muted)", background: settingsTab === "integrations" ? "rgba(59, 130, 246, 0.15)" : "transparent" }}>
          <span style={{marginRight: '10px'}}>☁️</span> Integrations
        </div>
        <div className={`nav-item ${settingsTab === "rbac" ? "active" : ""}`} onClick={() => setSettingsTab("rbac")} style={{ margin: "4px 16px", cursor: "pointer", padding: "10px 16px", borderRadius: "8px", color: settingsTab === "rbac" ? "var(--accent-color)" : "var(--text-muted)", background: settingsTab === "rbac" ? "rgba(59, 130, 246, 0.15)" : "transparent" }}>
          <span style={{marginRight: '10px'}}>🔐</span> Team & Access
        </div>
      </div>

      {/* Settings Content Area */}
      <div style={{ flex: 1, padding: "32px 48px", overflowY: "auto" }}>
        {settingsTab === "org" && (
          <div style={{ maxWidth: "1000px" }}>
            <h1 style={{ margin: "0 0 4px", fontSize: "24px" }}>Organization hierarchy</h1>
            <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "0 0 1.25rem", maxWidth: "50ch" }}>
              Entities, ERP connections, governance and alerting — in one place.
            </p>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} onBlur={saveCustomerName} style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "rgba(255,255,255,0.05)", color: "white", minWidth: "220px", fontWeight: "500" }} />
                <div style={{ position: "relative" }}>
                  <input type="text" placeholder="Search entities, vendors, accounts" style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "rgba(255,255,255,0.05)", color: "white", minWidth: "230px" }} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ background: "rgba(59, 130, 246, 0.15)", color: "var(--accent-color)", padding: "4px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: "500" }}>Growth plan · {orgData.entities?.length || 0} of 5 entities used</span>
                <button className="btn-primary" style={{ padding: "6px 12px", fontSize: "13px", border: 'none', borderRadius: '4px', background: 'var(--accent-color)', color: 'white', cursor: 'pointer' }}>+ Add legal entity</button>
              </div>
            </div>

            <p style={{ fontSize: "13px", fontWeight: "500", margin: "0 0 0.75rem" }}>Legal entities <span style={{ color: "var(--text-muted)", fontWeight: "400" }}>({orgData.entities?.length || 0})</span></p>

            {orgData.entities?.map((ent) => (
              <div key={ent.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-color)", borderRadius: "8px", marginBottom: "0.75rem", overflow: "hidden" }}>
                
                <div 
                  onClick={() => setExpandedEntity(expandedEntity === ent.id ? null : ent.id)}
                  style={{ padding: "1.25rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", borderBottom: expandedEntity === ent.id ? "1px solid var(--border-color)" : "none" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "8px", background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "19px" }}>🏢</div>
                    <div>
                      <p style={{ fontSize: "16px", fontWeight: "500", margin: "0", color: "var(--text-primary)" }}>{ent.company_name}</p>
                      <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "2px 0 0" }}>Legal entity · {ent.company_code}</p>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ background: ent.status === 'Active' ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)", color: ent.status === 'Active' ? "var(--success-color)" : "var(--danger-color)", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: "600" }}>{ent.status}</span>
                    <button style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "white", padding: "6px 12px", borderRadius: "4px", fontSize: "12px", cursor: "pointer" }}>Edit details</button>
                  </div>
                </div>

                {expandedEntity === ent.id && (
                  <div style={{ padding: "0" }}>
                    <div style={{ display: "flex", borderBottom: "1px solid var(--border-color)", padding: "0 1.5rem", overflowX: "auto" }}>
                      {['Details', 'Vendors', 'Chart of Accounts', 'Item Masters', 'Custom Dimensions'].map(t => (
                        <div key={t} onClick={() => setActiveEntityTab(t)} style={{ padding: "12px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: activeEntityTab === t ? "var(--accent-color)" : "var(--text-muted)", borderBottom: activeEntityTab === t ? "2px solid var(--accent-color)" : "2px solid transparent", marginBottom: "-1px", whiteSpace: "nowrap" }}>
                          {t}
                        </div>
                      ))}
                    </div>

                    <div style={{ padding: "1.5rem", minHeight: "200px" }}>
                      {activeEntityTab === 'Details' && (
                        <div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "1.5rem" }}>
                            <div>
                              <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "4px" }}>COMPANY CODE</label>
                              <input type="text" value={ent.company_code || ''} onChange={(e) => handleEntityChange(ent.id, 'company_code', e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "rgba(0,0,0,0.2)", color: "white", fontSize: "13px" }} />
                            </div>
                            <div>
                              <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "4px" }}>ENTITY NAME</label>
                              <input type="text" value={ent.company_name || ''} onChange={(e) => handleEntityChange(ent.id, 'company_name', e.target.value)} style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "rgba(0,0,0,0.2)", color: "white", fontSize: "13px" }} />
                            </div>
                            <div>
                              <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "4px" }}>ENTITY TYPE</label>
                              <input type="text" value="Manufacturing entity" readOnly style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "rgba(0,0,0,0.2)", color: "white", fontSize: "13px", opacity: 0.7 }} />
                            </div>
                          </div>

                          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", paddingBottom: "1.5rem" }}>
                            <button 
                              onClick={() => handleSyncERP(ent.id)} 
                              style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "white", padding: "8px 16px", borderRadius: "6px", fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}
                              disabled={syncing}
                            >
                              {syncing ? "Syncing..." : "Sync from ERPNext"}
                            </button>
                            <button onClick={() => saveEntityDetails(ent.id)} style={{ background: "var(--accent-color)", color: "white", border: "none", padding: "8px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: "500", cursor: "pointer" }}>Save details</button>
                          </div>
                        </div>
                      )}
                      
                      {activeEntityTab !== 'Details' && <div style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic', padding: '1rem' }}>No data available. Please sync from ERPNext.</div>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        
        {settingsTab === "integrations" && (
          <div style={{ maxWidth: "800px", padding: "40px" }}>
            <div style={{ textAlign: "center", padding: "60px 40px", background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border-color)", borderRadius: "12px" }}>
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>☁️</div>
              <h2 style={{ fontSize: "20px", margin: "0 0 8px" }}>ERP Integrations</h2>
              <p style={{ color: "var(--text-muted)", margin: "0 0 24px", maxWidth: "400px", marginLeft: "auto", marginRight: "auto" }}>
                Connect Produce.Ai directly to ERPNext and Shopify to automatically fetch orders and post Work Orders.
              </p>
              <button style={{ background: "var(--accent-color)", color: "white", border: "none", padding: "8px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: "500", cursor: "pointer" }}>Connect ERP System</button>
            </div>
          </div>
        )}
        
        {settingsTab === "rbac" && (
          <div style={{ maxWidth: "800px", padding: "40px" }}>
            <div style={{ textAlign: "center", padding: "60px 40px", background: "rgba(255,255,255,0.02)", border: "1px dashed var(--border-color)", borderRadius: "12px" }}>
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>🔐</div>
              <h2 style={{ fontSize: "20px", margin: "0 0 8px" }}>Team & Access Control</h2>
              <p style={{ color: "var(--text-muted)", margin: "0 0 24px", maxWidth: "400px", marginLeft: "auto", marginRight: "auto" }}>
                Manage user roles, define approval hierarchies, and control who can process Work Orders.
              </p>
              <button style={{ background: "var(--accent-color)", color: "white", border: "none", padding: "8px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: "500", cursor: "pointer" }}>Invite Team Member</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Settings;
