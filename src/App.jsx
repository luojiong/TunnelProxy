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

  // 加载保存的规则
  useEffect(() => {
    const loadRules = async () => {
      const savedRules = await window.electron.ipcRenderer.invoke('get-forwarding-rules');
      setForwardings(savedRules);
    };
    loadRules();
  }, []);

  // 监听规则更新
  useEffect(() => {
    const unsubscribe = window.electron.ipcRenderer.on('forwarding-rules-updated', (rules) => {
      setForwardings(rules);
    });

    return () => unsubscribe();
  }, []);

  const formatHost = (host) => {
    return host.replace(/^https?:\/\//, ''); // 移除 http:// 或 https:// 前缀
  };

  const handleSubmit = (values) => {
    const { remoteHost, remotePort, localPort } = values;
    const formattedHost = formatHost(remoteHost);
    const newForwarding = {
      id: `${formattedHost}:${remotePort}->${localPort}`,
      remoteHost: formattedHost,
      remotePort,
      localPort,
      status: 'running'
    };

    ipcRenderer.send('start-forwarding', {
      remoteHost: formattedHost,
      remotePort,
      localPort
    });

    setForwardings([...forwardings, newForwarding]);
    form.resetFields();
    message.success(t('Add success'));
  };

  const handleStop = (id) => {
    ipcRenderer.send('stop-forwarding', id);
    message.info(t('Stop success'));
  };

  const handleDelete = (id) => {
    ipcRenderer.send('delete-forwarding', id);
    message.success(t('Delete success'));
  };

  useEffect(() => {
    const unsubscribe = window.electron.ipcRenderer.on('forwarding-status', ({ id, status, error }) => {
      setForwardings(prev => 
        prev.map(f => f.id === id ? { ...f, status, error } : f)
      );
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleEdit = (record) => {
    setEditingRule(record);
    editForm.setFieldsValue({
      remoteHost: record.remoteHost,
      remotePort: record.remotePort,
      localPort: record.localPort,
    });
    setEditModalVisible(true);
  };

  const handleEditSubmit = async (values) => {
    const { remoteHost, remotePort, localPort } = values;
    const formattedHost = formatHost(remoteHost);
    const newId = `${formattedHost}:${remotePort}->${localPort}`;
    
    // 检查新ID是否与其他规则冲突（除了当前编辑的规则）
    const isDuplicate = forwardings.some(f => 
      f.id === newId && f.id !== editingRule.id
    );

    if (isDuplicate) {
      message.error(t('Rule already exists'));
      return;
    }

    // 如果规则正在运行，需要先停止
    if (editingRule.status === 'running') {
      ipcRenderer.send('stop-forwarding', editingRule.id);
    }

    ipcRenderer.send('edit-forwarding', {
      oldId: editingRule.id,
      newRule: {
        id: newId,
        remoteHost: formattedHost,
        remotePort,
        localPort,
        status: 'stopped'
      }
    });

    setEditModalVisible(false);
    message.success(t('Edit success'));
  };

  const handleStart = (record) => {
    const formattedHost = formatHost(record.remoteHost);
    ipcRenderer.send('start-forwarding', {
      remoteHost: formattedHost,
      remotePort: record.remotePort,
      localPort: record.localPort
    });
    message.success(t('Start success'));
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
              <LinkOutlined className="text-2xl text-white" /> {t('Port Forwarder')}
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
            className="flex  gap-4"
          >
            <div className="flex-1">
              <Form.Item
                name="remoteHost"
                rules={[
                  { required: true, message: t('Please input remote host') },
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
                  placeholder={t('Remote Host')} 
                  className="rounded-lg h-11"
                  prefix={
                    <div className="bg-blue-50 px-2 py-1 rounded-md mr-3">
                      <LinkOutlined className="text-blue-500" />
                    </div>
                  }
                />
              </Form.Item>
            </div>

            <div className="w-120">
              <Form.Item
                name="remotePort"
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

            <div className="w-120">
              <Form.Item
                name="localPort"
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

            <Form.Item className="mb-0 w-40">
              <Button 
                type="primary" 
                htmlType="submit" 
                icon={<PlayCircleOutlined />}
                className="w-full rounded-lg h-11 text-base font-medium hover:scale-105 transform transition-transform"
              >
                {t('Add Forward')}
              </Button>
            </Form.Item>
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