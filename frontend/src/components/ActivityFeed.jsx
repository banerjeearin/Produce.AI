import React, { useState, useEffect } from 'react';
import { getActivities } from '../services/api';

const ActivityFeed = ({ dateFrom, dateTo }) => {
    const [activities, setActivities] = useState([]);
    const [copiedDocId, setCopiedDocId] = useState(null);

    useEffect(() => {
        const fetchActivities = async () => {
            try {
                const data = await getActivities(100, dateFrom, dateTo);
                setActivities(data);
            } catch (e) {
                console.error(e);
            }
        };

        fetchActivities();
        const interval = setInterval(fetchActivities, 5000);
        return () => clearInterval(interval);
    }, [dateFrom, dateTo]);

    const getIconClass = (type) => {
        if (type === 'SUCCESS') return 'success ri-check-line';
        if (type === 'ERROR') return 'warning ri-alert-line'; // Red/Warning
        if (type === 'WARNING') return 'warning ri-error-warning-line';
        return 'primary ri-information-line';
    };
    
    const timeAgo = (dateStr) => {
        const d = new Date(dateStr);
        const diff = Math.floor((new Date() - d) / 1000);
        if (diff < 60) return `${diff} sec ago`;
        if (diff < 3600) return `${Math.floor(diff/60)} min ago`;
        if (diff < 86400) return `${Math.floor(diff/3600)} hr ago`;
        return `${Math.floor(diff/86400)} days ago`;
    };

    return (
        <div className="card glass-panel activity-card">
            <div className="card-header">
                <h3><i className="ri-history-line text-primary"></i> Recent Pipeline Activity</h3>
            </div>
            <div className="activity-feed">
                {activities.length === 0 ? (
                    <div className="activity-item">
                        <div className="activity-content">
                            <p>No activity yet.</p>
                        </div>
                    </div>
                ) : (
                    activities.map((act, idx) => (
                        <div className="activity-item" key={idx}>
                            <div className={`activity-icon ${getIconClass(act.type).split(' ')[0]}`}>
                                <i className={getIconClass(act.type).split(' ')[1]}></i>
                            </div>
                            <div className="activity-content">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <h4>{act.title}</h4>
                                    {act.doc_reference && (
                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginLeft: '0.5rem' }}>
                                            <span style={{ 
                                                fontFamily: 'monospace', 
                                                color: '#38bdf8', 
                                                background: 'rgba(56, 189, 248, 0.1)', 
                                                border: '1px solid rgba(56, 189, 248, 0.3)', 
                                                padding: '0.15rem 0.4rem', 
                                                borderRadius: '4px',
                                                fontSize: '0.75rem',
                                                fontWeight: '600'
                                            }}>
                                                {act.doc_reference}
                                            </span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigator.clipboard.writeText(act.doc_reference);
                                                    const key = `${act.id || idx}-${act.doc_reference}`;
                                                    setCopiedDocId(key);
                                                    setTimeout(() => setCopiedDocId(null), 2000);
                                                }}
                                                style={{
                                                    background: copiedDocId === `${act.id || idx}-${act.doc_reference}` ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                                                    border: copiedDocId === `${act.id || idx}-${act.doc_reference}` ? '1px solid #10b981' : '1px solid var(--border-glass)',
                                                    color: copiedDocId === `${act.id || idx}-${act.doc_reference}` ? '#10b981' : 'var(--text-muted)',
                                                    borderRadius: '4px',
                                                    padding: '0.15rem 0.35rem',
                                                    cursor: 'pointer',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    fontSize: '0.75rem',
                                                    transition: 'all 0.15s ease'
                                                }}
                                                title={copiedDocId === `${act.id || idx}-${act.doc_reference}` ? "Copied!" : "Copy Reference"}
                                            >
                                                <i className={copiedDocId === `${act.id || idx}-${act.doc_reference}` ? "ri-check-line" : "ri-file-copy-line"}></i>
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <p>{act.description}</p>
                                <span className="time">{timeAgo(act.created_at)}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default ActivityFeed;
