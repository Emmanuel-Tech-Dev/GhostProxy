import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, Select, Button, Row, Col, Input } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { getRecentLogs } from '../api/analytics'
import { getRoutes } from '../api/routes'
import LogTable from '../component/shared/LogTable'

export default function Logs() {
    const [filters, setFilters] = useState({
        limit: 50,
        offset: 0,
        route_prefix: undefined,
    })

    const { data: routes } = useQuery({
        queryKey: ['routes'],
        queryFn: () => getRoutes().then((r) => r.data.data),
    })

    const { data: logs, isLoading, refetch, isFetching } = useQuery({
        queryKey: ['logs', filters],
        queryFn: () => getRecentLogs(filters).then((r) => r.data.data),
        refetchInterval: 10000,
    })

    const routeOptions = [
        { value: undefined, label: 'All routes' },
        ...(routes || []).map((r) => ({
            value: r.prefix,
            label: r.prefix,
        })),
    ]

    const handleFilterChange = (key, value) => {
        setFilters((prev) => ({ ...prev, [key]: value, offset: 0 }))
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-white text-xl font-semibold">Logs</h1>
                    <p className="text-[#8888AA] text-sm">
                        Live request log — refreshes every 10 seconds
                    </p>
                </div>
                <Button
                    icon={<ReloadOutlined spin={isFetching} />}
                    onClick={() => refetch()}
                >
                    Refresh
                </Button>
            </div>

            <Card>
                <Row gutter={[12, 12]} className="mb-4">
                    <Col xs={24} sm={12} md={8}>
                        <div className="space-y-1">
                            <p className="text-[#8888AA] text-xs uppercase tracking-wider">
                                Route
                            </p>
                            <Select
                                style={{ width: '100%' }}
                                value={filters.route_prefix}
                                onChange={(v) => handleFilterChange('route_prefix', v)}
                                options={routeOptions}
                                placeholder="All routes"
                            />
                        </div>
                    </Col>
                    <Col xs={24} sm={12} md={8}>
                        <div className="space-y-1">
                            <p className="text-[#8888AA] text-xs uppercase tracking-wider">
                                Limit
                            </p>
                            <Select
                                style={{ width: '100%' }}
                                value={filters.limit}
                                onChange={(v) => handleFilterChange('limit', v)}
                                options={[
                                    { value: 25, label: '25 rows' },
                                    { value: 50, label: '50 rows' },
                                    { value: 100, label: '100 rows' },
                                    { value: 200, label: '200 rows' },
                                ]}
                            />
                        </div>
                    </Col>
                </Row>

                <LogTable
                    data={logs || []}
                    loading={isLoading}
                    pagination={{
                        pageSize: filters.limit,
                        showTotal: (total) => `${total} entries`,
                    }}
                />
            </Card>
        </div>
    )
}