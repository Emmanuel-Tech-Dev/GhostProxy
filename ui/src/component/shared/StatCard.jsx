import { Card } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'

export default function StatCard({ title, value, suffix, trend, trendLabel, color = '#E94560' }) {
    return (
        <Card className="h-full">
            <p className="text-[#8888AA] text-xs uppercase tracking-widest mb-3">
                {title}
            </p>
            <div className="flex items-end justify-between">
                <div>
                    <span
                        className="text-3xl font-bold"
                        style={{ color, fontFamily: 'monospace' }}
                    >
                        {value ?? '—'}
                    </span>
                    {suffix && (
                        <span className="text-[#8888AA] text-sm ml-1">{suffix}</span>
                    )}
                </div>
                {trend !== undefined && (
                    <div className={`flex items-center gap-1 text-xs ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {trend >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                        <span>{Math.abs(trend)}%</span>
                        {trendLabel && <span className="text-[#8888AA]">{trendLabel}</span>}
                    </div>
                )}
            </div>
        </Card>
    )
}