import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    Card, Form, Input, Button, Row, Col,
    Table, Tag, Popconfirm, message, Divider, Alert
} from 'antd'
import {
    KeyOutlined, DeleteOutlined, CopyOutlined, UserOutlined
} from '@ant-design/icons'
import { getMe } from '../api/auth'
import client from '../api/client'
import useAuthStore from '../store/authStore'

function useApiKeys() {
    return useQuery({
        queryKey: ['api-keys'],
        queryFn: () => client.get('/api/keys').then((r) => r.data.data),
    })
}

export default function Settings() {
    const [profileForm] = Form.useForm()
    const [passwordForm] = Form.useForm()
    const [messageApi, contextHolder] = message.useMessage()
    const queryClient = useQueryClient()
    const user = useAuthStore((s) => s.user)
    const setAuth = useAuthStore((s) => s.setAuth)
    const [newKey, setNewKey] = useState(null)

    const { data: profile } = useQuery({
        queryKey: ['me'],
        queryFn: () => getMe().then((r) => r.data.data),
        onSuccess: (data) => profileForm.setFieldsValue(data),
    })

    const { data: apiKeys, isLoading: keysLoading } = useApiKeys()

    const updateProfile = useMutation({
        mutationFn: (data) => client.patch('/api/account', data),
        onSuccess: ({ data }) => {
            setAuth(data.data.access_token, data.data.user)
            messageApi.success('Profile updated')
        },
        onError: (err) => messageApi.error(err.response?.data?.error || 'Update failed'),
    })

    const updatePassword = useMutation({
        mutationFn: (data) => client.patch('/api/account/password', data),
        onSuccess: () => {
            passwordForm.resetFields()
            messageApi.success('Password updated')
        },
        onError: (err) => messageApi.error(err.response?.data?.error || 'Update failed'),
    })

    const createKey = useMutation({
        mutationFn: (data) => client.post('/api/keys', data),
        onSuccess: ({ data }) => {
            queryClient.invalidateQueries({ queryKey: ['api-keys'] })
            setNewKey(data.data.raw_key)
        },
        onError: (err) => messageApi.error(err.response?.data?.error || 'Failed to create key'),
    })

    const deleteKey = useMutation({
        mutationFn: (id) => client.delete(`/api/keys/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['api-keys'] })
            messageApi.success('Key deleted')
        },
        onError: (err) => messageApi.error(err.response?.data?.error || 'Failed to delete key'),
    })

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text)
        messageApi.success('Copied to clipboard')
    }

    const keyColumns = [
        {
            title: 'Label',
            dataIndex: 'label',
            key: 'label',
            render: (v) => <span className="text-white text-sm">{v}</span>,
        },
        {
            title: 'Prefix',
            dataIndex: 'key_prefix',
            key: 'key_prefix',
            render: (v) => (
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#8888AA' }}>
                    {v}...
                </span>
            ),
        },
        {
            title: 'Type',
            dataIndex: 'type',
            key: 'type',
            render: (v) => (
                <Tag color={v === 'management' ? 'blue' : 'purple'}>{v}</Tag>
            ),
        },
        {
            title: 'Status',
            dataIndex: 'is_active',
            key: 'is_active',
            render: (v) => (
                <Tag color={v ? 'success' : 'error'}>{v ? 'Active' : 'Revoked'}</Tag>
            ),
        },
        {
            title: 'Created',
            dataIndex: 'created_at',
            key: 'created_at',
            render: (v) => (
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8888AA' }}>
                    {new Date(v).toLocaleDateString()}
                </span>
            ),
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 80,
            render: (_, r) => (
                <Popconfirm
                    title="Delete this key?"
                    description="This cannot be undone."
                    onConfirm={() => deleteKey.mutate(r.id)}
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                >
                    <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                    />
                </Popconfirm>
            ),
        },
    ]

    return (
        <div className="space-y-6">
            {contextHolder}

            <div>
                <h1 className="text-white text-xl font-semibold">Settings</h1>
                <p className="text-[#8888AA] text-sm">Manage your account and API keys</p>
            </div>

            <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                    <Card title={<span className="text-white text-sm">Profile</span>}>
                        <Form
                            form={profileForm}
                            layout="vertical"
                            onFinish={(v) => updateProfile.mutate(v)}
                            requiredMark={false}
                            initialValues={profile}
                        >
                            <Form.Item name="full_name" label="Full name">
                                <Input prefix={<UserOutlined className="text-[#8888AA]" />} />
                            </Form.Item>

                            <Form.Item name="email" label="Email">
                                <Input disabled />
                            </Form.Item>

                            <Form.Item>
                                <Button
                                    type="primary"
                                    htmlType="submit"
                                    loading={updateProfile.isPending}
                                >
                                    Save changes
                                </Button>
                            </Form.Item>
                        </Form>
                    </Card>
                </Col>

                <Col xs={24} lg={12}>
                    <Card title={<span className="text-white text-sm">Change Password</span>}>
                        <Form
                            form={passwordForm}
                            layout="vertical"
                            onFinish={(v) => updatePassword.mutate(v)}
                            requiredMark={false}
                        >
                            <Form.Item
                                name="current_password"
                                label="Current password"
                                rules={[{ required: true, message: 'Required' }]}
                            >
                                <Input.Password />
                            </Form.Item>

                            <Form.Item
                                name="new_password"
                                label="New password"
                                rules={[
                                    { required: true, message: 'Required' },
                                    { min: 8, message: 'Minimum 8 characters' },
                                ]}
                            >
                                <Input.Password />
                            </Form.Item>

                            <Form.Item
                                name="confirm"
                                label="Confirm new password"
                                dependencies={['new_password']}
                                rules={[
                                    { required: true, message: 'Required' },
                                    ({ getFieldValue }) => ({
                                        validator(_, value) {
                                            if (!value || getFieldValue('new_password') === value) {
                                                return Promise.resolve()
                                            }
                                            return Promise.reject('Passwords do not match')
                                        },
                                    }),
                                ]}
                            >
                                <Input.Password />
                            </Form.Item>

                            <Form.Item>
                                <Button
                                    type="primary"
                                    htmlType="submit"
                                    loading={updatePassword.isPending}
                                >
                                    Update password
                                </Button>
                            </Form.Item>
                        </Form>
                    </Card>
                </Col>
            </Row>

            <Card
                title={<span className="text-white text-sm">API Keys</span>}
                extra={
                    <Button
                        type="primary"
                        size="small"
                        icon={<KeyOutlined />}
                        onClick={() => createKey.mutate({ label: 'New Key', type: 'management' })}
                        loading={createKey.isPending}
                    >
                        Generate Key
                    </Button>
                }
            >
                {newKey && (
                    <Alert
                        className="mb-4"
                        type="success"
                        message="Key generated — copy it now, it will not be shown again"
                        description={
                            <div className="flex items-center gap-2 mt-2">
                                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                                    {newKey}
                                </span>
                                <Button
                                    size="small"
                                    icon={<CopyOutlined />}
                                    onClick={() => copyToClipboard(newKey)}
                                >
                                    Copy
                                </Button>
                            </div>
                        }
                        closable
                        onClose={() => setNewKey(null)}
                    />
                )}

                <Table
                    columns={keyColumns}
                    dataSource={apiKeys || []}
                    loading={keysLoading}
                    rowKey="id"
                    size="small"
                    pagination={false}
                />
            </Card>

            <Card title={<span className="text-white text-sm">Instance Info</span>}>
                <div className="space-y-3">
                    {[
                        { label: 'Plan', value: user?.plan_tier, color: '#A78BFA' },
                        { label: 'Email', value: user?.email, color: '#E2E2F0' },
                        { label: 'Version', value: 'v2.0.0', color: '#8888AA' },
                        { label: 'Mode', value: 'Self-hosted', color: '#4ADE80' },
                    ].map(({ label, value, color }) => (
                        <div
                            key={label}
                            className="flex items-center justify-between py-2 border-b border-[#2A2A45] last:border-0"
                        >
                            <span className="text-[#8888AA] text-xs uppercase tracking-wider">
                                {label}
                            </span>
                            <span style={{ fontFamily: 'monospace', color, fontSize: 13 }}>
                                {value}
                            </span>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    )
}