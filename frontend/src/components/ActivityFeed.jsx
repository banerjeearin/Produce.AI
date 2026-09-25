import React, { useState, useEffect } from 'react';
import { getActivities } from '../services/api';

const ActivityFeed = () => {
    const [activities, setActivities] = useState([]);

    useEffect(() => {
        const fetchActivities = async () => {
            try {
                const data = await getActivities();
                setActivities(data);
            } catch (e) {
                console.error(e);
            }
        };

        fetchActivities();
        const interval = setInterval(fetchActivities, 5000);
        return () => clearInterval(interval);
    }, []);

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
                                <h4>{act.title}</h4>
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
