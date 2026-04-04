import { Table, Tag } from 'antd'
import StatusBadge from './StatusBadge'

const columns = [
    {
        title: 'Time',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 160,
        render: (v) => (
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8888AA' }}>
                {new Date(v).toLocaleTimeString()}
            </span>
        ),
    },
    {
        title: 'Method',
        dataIndex: 'method',
        key: 'method',
        width: 80,
        render: (v) => {
            const colors = { GET: 'green', POST: 'blue', PATCH: 'orange', DELETE: 'red', PUT: 'purple' }
            return <Tag color={colors[v] || 'default'}>{v}</Tag>
        },
    },
    {
        title: 'Path',
        dataIndex: 'path',
        key: 'path',
        render: (v) => (
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>
        ),
    },
    {
        title: 'Status',
        dataIndex: 'status_code',
        key: 'status_code',
        width: 80,
        render: (v) => <StatusBadge status={v} />,
    },
    {
        title: 'Duration',
        dataIndex: 'duration_ms',
        key: 'duration_ms',
        width: 100,
        render: (v) => (
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: v > 500 ? '#F87171' : '#4ADE80' }}>
                {v}ms
            </span>
        ),
    },
    {
        title: 'Cache',
        dataIndex: 'cache_hit',
        key: 'cache_hit',
        width: 80,
        render: (v) => (
            <span style={{ color: v ? '#4ADE80' : '#8888AA', fontSize: 11, fontFamily: 'monospace' }}>
                {v ? 'HIT' : 'MISS'}
            </span>
        ),
    },
    {
        title: 'IP',
        dataIndex: 'client_ip',
        key: 'client_ip',
        width: 130,
        render: (v) => (
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8888AA' }}>{v}</span>
        ),
    },
]

export default function LogTable({ data = [], loading = false, pagination = false }) {
    return (
        <Table
            columns={columns}
            dataSource={data}
            loading={loading}
            pagination={pagination}
            rowKey="id"
            size="small"
            scroll={{ x: 800 }}
        />
    )
}