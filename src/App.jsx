import React, { useState, useEffect } from 'react';
import { Table, Form, Input, Button, Card, Space, Tag, message, Popconfirm, Modal, Select, Typography } from 'antd';
import { PlayCircleOutlined, StopOutlined, DeleteOutlined, EditOutlined, GlobalOutlined, LinkOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
const { ipcRenderer } = window.electron;
const { Option } = Select;
const { Title } = Typography;

function App() {
  const { t, i18n } = useTranslation();
  const [forwardings, setForwardings] = useState([]);
  const [form] = Form.useForm();
  const [editingRule, setEditingRule] = useState(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm] = Form.useForm();
  const [mode, setMode] = useState('forward');

  // 加载保存的规则
  useEffect(() => {
    let mounted = true;

    const loadRules = async () => {
      try {
        const savedRules = await window.electron.ipcRenderer.invoke('get-forwarding-rules');
        if (mounted) {
          setForwardings(savedRules || []);
        }
      } catch (error) {
        console.error('加载规则失败:', error);
      }
    };

    loadRules();

    return () => {
      mounted = false;
    };
  }, []);

  // 监听规则更新
  useEffect(() => {
    let isSubscribed = true;

    const handleRulesUpdate = (rules) => {
      if (isSubscribed) {
        setForwardings(rules || []);
      }
    };

    const unsubscribe = window.electron.ipcRenderer.on('forwarding-rules-updated', handleRulesUpdate);

    return () => {
      isSubscribed = false;
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch (error) {
          console.error('清理监听器失败:', error);
        }
      }
    };
  }, []);

  const formatHost = (host) => {
    return host.replace(/^https?:\/\//, ''); // 移除 http:// 或 https:// 前缀
  };

  const handleSubmit = (values) => {
    try {
      if (mode === 'reverse-ssh') {
        const { remoteHost, sshUser, sshPassword, sshPort, remotePort, localPort } = values;
        const sshHost = formatHost(remoteHost);
        const id = `${sshHost}:${remotePort}<-${localPort}`;
        window.electron.ipcRenderer.send('start-reverse-ssh', {
          sshHost,
          sshPort: sshPort || 22,
          sshUser,
          sshPassword,
          authType: 'password',
          remoteBindHost: '127.0.0.1',
          remotePort,
          localPort,
          id
        });
      } else {
        const { remoteHost, remotePort, localPort } = values;
        const formattedHost = formatHost(remoteHost);
        window.electron.ipcRenderer.send('start-forwarding', {
          remoteHost: formattedHost,
          remotePort,
          localPort
        });
      }

      form.resetFields();
      message.success(t('Add success'));
    } catch (error) {
      console.error('提交失败:', error);
      message.error(t('Add failed'));
    }
  };

  const handleStop = (id) => {
    try {
      const rule = forwardings.find(f => f.id === id);
      if (rule?.type === 'reverse-ssh') {
        window.electron.ipcRenderer.send('stop-reverse-ssh', id);
      } else {
        window.electron.ipcRenderer.send('stop-forwarding', id);
      }
      message.info(t('Stop success'));
    } catch (error) {
      console.error('停止失败:', error);
      message.error(t('Stop failed'));
    }
  };

  const handleDelete = (id) => {
    try {
      window.electron.ipcRenderer.send('delete-forwarding', id);
      message.success(t('Delete success'));
    } catch (error) {
      console.error('删除失败:', error);
      message.error(t('Delete failed'));
    }
  };

  useEffect(() => {
    let isSubscribed = true;

    const handleStatusUpdate = ({ id, status, error }) => {
      if (isSubscribed) {
        setForwardings(prev => 
          prev.map(f => f.id === id ? { ...f, status, error } : f)
        );
      }
    };

    const unsubscribe = window.electron.ipcRenderer.on('forwarding-status', handleStatusUpdate);

    return () => {
      isSubscribed = false;
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch (error) {
          console.error('清理监听器失败:', error);
        }
      }
    };
  }, []);

  const handleEdit = (record) => {
    setEditingRule(record);
    editForm.setFieldsValue({
      remoteHost: record.type === 'reverse-ssh' ? record.sshHost : record.remoteHost,
      remotePort: record.remotePort,
      localPort: record.localPort,
    });
    setEditModalVisible(true);
  };

  const handleEditSubmit = async (values) => {
    let newRule = null;
    let newId = null;
    if (editingRule.type === 'reverse-ssh') {
      const { remoteHost, remotePort, localPort } = values;
      const sshHost = formatHost(remoteHost);
      newId = `${sshHost}:${remotePort}<-${localPort}`;
      newRule = {
        id: newId,
        type: 'reverse-ssh',
        sshHost,
        sshPort: editingRule.sshPort || 22,
        sshUser: editingRule.sshUser,
        sshPassword: editingRule.sshPassword,
        authType: editingRule.authType || 'password',
        remoteBindHost: editingRule.remoteBindHost || '127.0.0.1',
        remotePort,
        localPort,
        status: 'stopped'
      };
    } else {
      const { remoteHost, remotePort, localPort } = values;
      const formattedHost = formatHost(remoteHost);
      newId = `${formattedHost}:${remotePort}->${localPort}`;
      newRule = {
        id: newId,
        remoteHost: formattedHost,
        remotePort,
        localPort,
        status: 'stopped'
      };
    }
    
    // 检查新ID是否与其他规则冲突（除了当前编辑的规则）
    const isDuplicate = forwardings.some(f => f.id === newId && f.id !== editingRule.id);

    if (isDuplicate) {
      message.error(t('Rule already exists'));
      return;
    }

    // 如果规则正在运行，需要先停止
    if (editingRule.status === 'running') {
      if (editingRule.type === 'reverse-ssh') {
        ipcRenderer.send('stop-reverse-ssh', editingRule.id);
      } else {
        ipcRenderer.send('stop-forwarding', editingRule.id);
      }
    }

    ipcRenderer.send('edit-forwarding', { oldId: editingRule.id, newRule });

    setEditModalVisible(false);
    message.success(t('Edit success'));
  };

  const handleStart = (record) => {
    try {
      if (record.type === 'reverse-ssh') {
        window.electron.ipcRenderer.send('start-reverse-ssh', {
          sshHost: record.sshHost,
          sshPort: record.sshPort || 22,
          sshUser: record.sshUser,
          sshPassword: record.sshPassword,
          authType: record.authType || 'password',
          keyPath: record.keyPath,
          remoteBindHost: record.remoteBindHost || '127.0.0.1',
          remotePort: record.remotePort,
          localPort: record.localPort,
          id: record.id
        });
      } else {
        const formattedHost = formatHost(record.remoteHost);
        window.electron.ipcRenderer.send('start-forwarding', {
          remoteHost: formattedHost,
          remotePort: record.remotePort,
          localPort: record.localPort
        });
      }
      message.success(t('Start success'));
    } catch (error) {
      console.error('启动失败:', error);
      message.error(t('Start failed'));
    }
  };

  const handleLanguageChange = (value) => {
    i18n.changeLanguage(value);
    localStorage.setItem('language', value);
  };

  const columns = [
    {
      title: t('Remote Host'),
      dataIndex: 'remoteHost',
      key: 'remoteHost',
      render: (_, r) => r.type === 'reverse-ssh' ? `${r.sshUser}@${r.sshHost}` : r.remoteHost,
    },
    {
      title: t('Remote Port'),
      dataIndex: 'remotePort',
      key: 'remotePort',
    },
    {
      title: t('Local Port'),
      dataIndex: 'localPort',
      key: 'localPort',
    },
    {
      title: t('Status'),
      dataIndex: 'status',
      key: 'status',
      render: (status, record) => (
        <Tag color={
          status === 'running' ? 'green' : 
          status === 'error' ? 'red' : 
          'gray'
        }>
          {status === 'running' ? t('Running') : 
           status === 'error' ? t('Error') : 
           t('Stopped')}
          {record.error && <div className="text-xs text-red-500">{record.error}</div>}
        </Tag>
      ),
    },
    {
      title: t('Actions'),
      key: 'action',
      render: (_, record) => (
        <Space>
          {record.status !== 'running' ? (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => handleStart(record)}
              disabled={record.status === 'running'}
            >
              {t('Start')}
            </Button>
          ) : (
            <Button
              type="primary"
              danger
              icon={<StopOutlined />}
              onClick={() => handleStop(record.id)}
              disabled={record.status !== 'running'}
            >
              {t('Stop')}
            </Button>
          )}
          <Button
            type="primary"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
            disabled={record.status === 'running'}
          >
            {t('Edit')}
          </Button>
          <Popconfirm
            title={t('Confirm Delete')}
            onConfirm={() => handleDelete(record.id)}
            okText={t('OK')}
            cancelText={t('Cancel')}
          >
            <Button 
              danger 
              icon={<DeleteOutlined />}
              disabled={record.status === 'running'}
            >
              {t('Delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      {/* 顶部导航栏 */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
             
              <Title level={3} style={{ margin: 0 }} className="bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">
              <LinkOutlined className="text-2xl text-white" /> {t('Tunnel Proxy')}
              </Title>

              <div className="flex items-center space-x-2 bg-gray-50 px-3 py-1.5 rounded-full right-lang">
                    <GlobalOutlined className="text-blue-500" />
                    <Select
                        defaultValue={i18n.language}
                        style={{ width: 90 }}
                        onChange={handleLanguageChange}
                        bordered={false}
                        dropdownStyle={{ borderRadius: '8px' }}
                        className="language-select"
                    >
                        <Option value="zh">中文</Option>
                        <Option value="en">English</Option>
                    </Select>
             </div>
            </div>
          </div>
        </div>
      </div>

      {/* 主要内容区域 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card 
          title={
            <div className="flex items-center space-x-2">
              <div className="bg-green-500/10 p-2 rounded-lg">
                <PlayCircleOutlined className="text-xl text-green-500" />
              </div>
              <span className="text-lg font-semibold">{t('Add Rule')}</span>
            </div>
          }
          className="mb-8 shadow-md hover:shadow-lg transition-shadow duration-300"
          bordered={false}
        >
          <Form
            form={form}
            onFinish={handleSubmit}
            layout="vertical"
            className="space-y-6"
          >
            {/* 第一行：模式选择 */}
            <div className="flex gap-4 items-end">
              <div className="w-60">
                <Form.Item name="type" label={t('Mode')} className="mb-0" initialValue={mode}>
                  <Select value={mode} onChange={(v) => setMode(v)} className="h-11">
                    <Option value="forward">{t('Forward')}</Option>
                    <Option value="reverse-ssh">{t('Reverse SSH')}</Option>
                  </Select>
                </Form.Item>
              </div>
            </div>

            {/* 第二行：主要配置 */}
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <Form.Item
                  name="remoteHost"
                  label={mode === 'reverse-ssh' ? t('SSH Host') : t('Remote Host')}
                  rules={[
                    { required: true, message: mode === 'reverse-ssh' ? t('Please input ssh host') : t('Please input remote host') },
                    {
                      validator: (_, value) => {
                        if (value && value.includes('://')) {
                          return Promise.reject(t('Do not enter http:// or https:// prefix'));
                        }
                        return Promise.resolve();
                      }
                    }
                  ]}
                  className="mb-0"
                >
                  <Input 
                    placeholder={mode === 'reverse-ssh' ? t('SSH Host example') : t('Remote Host')} 
                    className="rounded-lg h-11"
                    prefix={
                      <div className="bg-blue-50 px-2 py-1 rounded-md mr-3">
                        <LinkOutlined className="text-blue-500" />
                      </div>
                    }
                  />
                </Form.Item>
              </div>

              <div className="w-100">
                <Form.Item
                  name="remotePort"
                  label={t('Remote Port')}
                  rules={[{ required: true, message: t('Please input remote port') }]}
                  className="mb-0"
                >
                  <Input 
                    type="number" 
                    placeholder={t('Remote Port')} 
                    className="rounded-lg h-11"
                    prefix={
                      <div className="bg-purple-50 px-2 py-1 rounded-md mr-3">
                        <span className="text-purple-500 font-medium">:</span>
                      </div>
                    }
                  />
                </Form.Item>
              </div>

              <div className="w-100">
                <Form.Item
                  name="localPort"
                  label={t('Local Port')}
                  rules={[{ required: true, message: t('Please input local port') }]}
                  className="mb-0"
                >
                  <Input 
                    type="number" 
                    placeholder={t('Local Port')} 
                    className="rounded-lg h-11"
                    prefix={
                      <div className="bg-green-50 px-2 py-1 rounded-md mr-3">
                        <span className="text-green-500 font-medium">→</span>
                      </div>
                    }
                  />
                </Form.Item>
              </div>

              <Form.Item className="mb-0">
                <Button 
                  type="primary" 
                  htmlType="submit" 
                  icon={<PlayCircleOutlined />}
                  className="h-11 px-8 text-base font-medium hover:scale-105 transform transition-transform"
                >
                  {t('Add Forward')}
                </Button>
              </Form.Item>
            </div>

            {/* 第三行：反向SSH认证信息 */}
            {mode === 'reverse-ssh' && (
              <div className="flex gap-4 items-end pt-4 border-t border-gray-200">
                <div className="flex-1">
                  <Form.Item
                    name="sshUser"
                    label={t('SSH User')}
                    rules={[{ required: true, message: t('Please input ssh user') }]}
                    className="mb-0"
                  >
                    <Input 
                      placeholder={t('SSH User')} 
                      className="rounded-lg h-11"
                      prefix={
                        <div className="bg-orange-50 px-2 py-1 rounded-md mr-3">
                          <span className="text-orange-500 font-medium">@</span>
                        </div>
                      }
                    />
                  </Form.Item>
                </div>

                <div className="flex-1">
                  <Form.Item
                    name="sshPassword"
                    label={t('SSH Password')}
                    rules={[{ required: true, message: t('Please input ssh password') }]}
                    className="mb-0"
                  >
                    <Input.Password 
                      placeholder={t('SSH Password')} 
                      className="rounded-lg h-11"
                      prefix={
                        <div className="bg-red-50 px-2 py-1 rounded-md mr-3">
                          <span className="text-red-500 font-medium">🔑</span>
                        </div>
                      }
                    />
                  </Form.Item>
                </div>

                <div className="w-32">
                  <Form.Item
                    name="sshPort"
                    label={t('SSH Port')}
                    initialValue={22}
                    className="mb-0"
                  >
                    <Input 
                      type="number" 
                      placeholder="22" 
                      className="rounded-lg h-11"
                    />
                  </Form.Item>
                </div>
              </div>
            )}
          </Form>
        </Card>

        <Card
          title={
            <div className="flex items-center space-x-2">
              <LinkOutlined className="text-blue-500" />
              <span>{t('Forward Rules')}</span>
            </div>
          }
          className="shadow-md hover:shadow-lg transition-shadow duration-300"
          bordered={false}
        >
          <Table
            columns={columns}
            dataSource={forwardings}
            rowKey="id"
            pagination={false}
            className="custom-table"
            rowClassName={(record) => 
              record.status === 'running' ? 'bg-green-50' :
              record.status === 'error' ? 'bg-red-50' : ''
            }
          />
        </Card>
      </div>

      {/* 编辑模态框 */}
      <Modal
        title={
          <div className="flex items-center space-x-2">
            <EditOutlined className="text-blue-500" />
            <span>{t('Edit Rule')}</span>
          </div>
        }
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        footer={null}
        className="custom-modal"
      >
        <Form
          form={editForm}
          onFinish={handleEditSubmit}
          layout="vertical"
        >
          <Form.Item
            name="remoteHost"
            label={t('Remote Host')}
            rules={[{ required: true, message: t('Please input remote host') }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="remotePort"
            label={t('Remote Port')}
            rules={[{ required: true, message: t('Please input remote port') }]}
          >
            <Input type="number" />
          </Form.Item>

          <Form.Item
            name="localPort"
            label={t('Local Port')}
            rules={[{ required: true, message: t('Please input local port') }]}
          >
            <Input type="number" />
          </Form.Item>

          <Form.Item className="mb-0 text-right">
            <Space>
              <Button onClick={() => setEditModalVisible(false)}>
                {t('Cancel')}
              </Button>
              <Button type="primary" htmlType="submit">
                {t('Save')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default App; 