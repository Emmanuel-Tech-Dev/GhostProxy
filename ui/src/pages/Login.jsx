import { Form, Input, Button, Alert } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { login } from '../api/auth'
import useAuthStore from '../store/authStore'

export default function Login() {
    const navigate = useNavigate()
    const setAuth = useAuthStore((s) => s.setAuth)
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(false)

    const onFinish = async (values) => {
        setError(null)
        setLoading(true)
        try {
            const { data } = await login(values)
            setAuth(data.data.access_token, data.data.user)
            navigate('/dashboard')
        } catch (err) {
            setError(err.response?.data?.error || 'Login failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#0F0F1A]">
            <div className="w-full max-w-sm">
                <div className="flex items-center gap-2 mb-8 justify-center">
                    <div className="w-2 h-2 rounded-full bg-[#E94560]" />
                    <span
                        style={{ fontFamily: 'monospace' }}
                        className="text-white font-bold tracking-widest text-sm"
                    >
                        GHOSTPROXY
                    </span>
                </div>

                <div
                    className="p-8 rounded-lg border border-[#2A2A45]"
                    style={{ background: '#16162A' }}
                >
                    <h1 className="text-white text-xl font-semibold mb-1">
                        Sign in
                    </h1>
                    <p className="text-[#8888AA] text-sm mb-6">
                        Enter your credentials to continue
                    </p>

                    {error && (
                        <Alert
                            message={error}
                            type="error"
                            showIcon
                            className="mb-4"
                        />
                    )}

                    <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
                        <Form.Item
                            name="email"
                            label="Email"
                            rules={[{ required: true, message: 'Email is required' }]}
                        >
                            <Input
                                type="email"
                                placeholder="you@example.com"
                                size="large"
                            />
                        </Form.Item>

                        <Form.Item
                            name="password"
                            label="Password"
                            rules={[{ required: true, message: 'Password is required' }]}
                        >
                            <Input.Password
                                placeholder="••••••••"
                                size="large"
                            />
                        </Form.Item>

                        <Form.Item className="mb-2">
                            <Button
                                type="primary"
                                htmlType="submit"
                                size="large"
                                block
                                loading={loading}
                            >
                                Sign in
                            </Button>
                        </Form.Item>
                    </Form>

                    <p className="text-center text-[#8888AA] text-sm mt-4">
                        No account?{' '}
                        <Link to="/register" className="text-[#E94560]">
                            Create one
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    )
}