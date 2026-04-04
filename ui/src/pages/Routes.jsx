import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    Table, Button, Modal, Form, Input, Switch,
    InputNumber, Popconfirm, Tag, Tooltip, message
} from 'antd'
import {
    PlusOutlined, EditOutlined, DeleteOutlined,
    CheckCircleOutlined, StopOutlined
} from '@ant-design/icons'
import {
    getRoutes, createRoute, updateRoute, deleteRoute
} from '../api/routes'

const defaultValues = {
    cache_enabled: true,
    cache_ttl_ms: 30000,
    rate_limit_enabled: true,
    rate_limit_capacity: 100,
    rate_limit_refill_rate: 10,
}

export default function Routes_() {
    const [form] = Form.useForm()
    const queryClient = useQueryClient()
    const [modal, setModal] = useState({ open: false, route: null })
    const [messageApi, contextHolder] = message.useMessage()

    const { data: routes, isLoading } = useQuery({
        queryKey: ['routes'],
        queryFn: () => getRoutes().then((r) => r.data),
    })



    const onCreate = useMutation({
        mutationFn: (data) => createRoute(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['routes'] })
            messageApi.success('Route created')
            closeModal()
        },
        onError: (err) => messageApi.error(err.response?.data?.error || 'Failed to create route'),
    })

    const onUpdate = useMutation({
        mutationFn: ({ id, data }) => updateRoute(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['routes'] })
            messageApi.success('Route updated')
            closeModal()
        },
        onError: (err) => messageApi.error(err.response?.data?.error || 'Failed to update route'),
    })

    const onDelete = useMutation({
        mutationFn: (id) => deleteRoute(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['routes'] })
            messageApi.success('Route deleted')
        },
        onError: (err) => messageApi.error(err.response?.data?.error || 'Failed to delete route'),
    })

    const onToggle = useMutation({
        mutationFn: ({ id, is_active }) => updateRoute(id, { is_active }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routes'] }),
    })

    const openCreate = () => {
        form.resetFields()
        form.setFieldsValue(defaultValues)
        setModal({ open: true, route: null })
    }

    const openEdit = (route) => {
        form.setFieldsValue(route)
        setModal({ open: true, route })
    }

    const closeModal = () => {
        setModal({ open: false, route: null })
        form.resetFields()
    }

    const onFinish = (values) => {
        if (modal.route) {
            onUpdate.mutate({ id: modal.route.id, data: values })
        } else {
            onCreate.mutate(values)
        }
    }

    const columns = [
        {
            title: 'Name',
            dataIndex: 'name',
            key: 'name',
            render: (v) => <span className="text-white text-sm">{v}</span>,
        },
        {
            title: 'Prefix',
            dataIndex: 'prefix',
            key: 'prefix',
            render: (v) => (
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#60A5FA' }}>
                    {v}
                </span>
            ),
        },
        {
            title: 'Upstream',
            dataIndex: 'upstream_url',
            key: 'upstream_url',
            render: (v) => (
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8888AA' }}>
                    {v}
                </span>
            ),
        },
        {
            title: 'Cache',
            key: 'cache',
            width: 80,
            render: (_, r) => (
                <Tag color={r.cache_enabled ? 'green' : 'default'}>
                    {r.cache_enabled ? 'ON' : 'OFF'}
                </Tag>
            ),
        },
        {
            title: 'Rate Limit',
            key: 'rate_limit',
            width: 100,
            render: (_, r) => (
                <Tag color={r.rate_limit_enabled ? 'blue' : 'default'}>
                    {r.rate_limit_enabled ? `${r.rate_limit_capacity}/burst` : 'OFF'}
                </Tag>
            ),
        },
        {
            title: 'Status',
            key: 'status',
            width: 90,
            render: (_, r) => (
                <Tooltip title={r.is_active ? 'Click to disable' : 'Click to enable'}>
                    <Tag
                        icon={r.is_active ? <CheckCircleOutlined /> : <StopOutlined />}
                        color={r.is_active ? 'success' : 'error'}
                        className="cursor-pointer"
                        onClick={() => onToggle.mutate({ id: r.id, is_active: r.is_active ? 0 : 1 })}
                    >
                        {r.is_active ? 'Active' : 'Inactive'}
                    </Tag>
                </Tooltip>
            ),
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 100,
            render: (_, r) => (
                <div className="flex items-center gap-2">
                    <Tooltip title="Edit">
                        <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openEdit(r)}
                        />
                    </Tooltip>
                    <Popconfirm
                        title="Delete this route?"
                        description="This cannot be undone."
                        onConfirm={() => onDelete.mutate(r.id)}
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                    >
                        <Tooltip title="Delete">
                            <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                            />
                        </Tooltip>
                    </Popconfirm>
                </div>
            ),
        },
    ]

    return (
        <div className="space-y-4">
            {contextHolder}

            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-white text-xl font-semibold">Routes</h1>
                    <p className="text-[#8888AA] text-sm">Manage your proxy routes</p>
                </div>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={openCreate}
                >
                    New Route
                </Button>
            </div>

            <Table
                columns={columns}
                dataSource={routes || []}
                loading={isLoading}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 20 }}
            />

            <Modal
                title={modal.route ? 'Edit Route' : 'New Route'}
                open={modal.open}
                onCancel={closeModal}
                onOk={() => form.submit()}
                confirmLoading={onCreate.isPending || onUpdate.isPending}
                okText={modal.route ? 'Save' : 'Create'}
                width={560}
                destroyOnHidden
            >
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={onFinish}
                    requiredMark={false}
                    className="mt-4"
                >
                    <Form.Item
                        name="name"
                        label="Name"
                        rules={[{ required: true, message: 'Required' }]}
                    >
                        <Input placeholder="My Legacy API" />
                    </Form.Item>

                    <Form.Item
                        name="prefix"
                        label="Prefix"
                        rules={[{ required: true, message: 'Required' }]}
                        tooltip="The path prefix the proxy listens on. Must start with /"
                    >
                        <Input placeholder="/proxy/users" style={{ fontFamily: 'monospace' }} />
                    </Form.Item>

                    <Form.Item
                        name="upstream_url"
                        label="Upstream URL"
                        rules={[{ required: true, message: 'Required' }]}
                        tooltip="The base URL requests are forwarded to"
                    >
                        <Input placeholder="https://api.example.com" style={{ fontFamily: 'monospace' }} />
                    </Form.Item>

                    <div className="flex gap-4">
                        <Form.Item name="cache_enabled" label="Cache" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                        <Form.Item name="cache_ttl_ms" label="TTL (ms)">
                            <InputNumber min={1000} style={{ width: 120 }} />
                        </Form.Item>
                    </div>

                    <div className="flex gap-4">
                        <Form.Item name="rate_limit_enabled" label="Rate Limit" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                        <Form.Item name="rate_limit_capacity" label="Capacity">
                            <InputNumber min={1} style={{ width: 100 }} />
                        </Form.Item>
                        <Form.Item name="rate_limit_refill_rate" label="Refill/s">
                            <InputNumber min={1} style={{ width: 100 }} />
                        </Form.Item>
                    </div>
                </Form>
            </Modal>
        </div>
    )
}