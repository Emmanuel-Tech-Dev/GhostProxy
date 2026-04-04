const colorMap = {
    200: { bg: '#0D2B1A', text: '#4ADE80', label: '200' },
    201: { bg: '#0D2B1A', text: '#4ADE80', label: '201' },
    304: { bg: '#1A2B0D', text: '#86EFAC', label: '304' },
    400: { bg: '#2B1A0D', text: '#FB923C', label: '400' },
    401: { bg: '#2B1A0D', text: '#FB923C', label: '401' },
    403: { bg: '#2B1A0D', text: '#FB923C', label: '403' },
    404: { bg: '#2B1A0D', text: '#FB923C', label: '404' },
    429: { bg: '#2B1A1A', text: '#F87171', label: '429' },
    500: { bg: '#2B0D0D', text: '#EF4444', label: '500' },
    502: { bg: '#2B0D0D', text: '#EF4444', label: '502' },
}

export default function StatusBadge({ status }) {
    const config = colorMap[status] || { bg: '#1E1E35', text: '#8888AA', label: status }

    return (
        <span
            style={{
                background: config.bg,
                color: config.text,
                fontFamily: 'monospace',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                fontWeight: 600,
            }}
        >
            {config.label}
        </span>
    )
}