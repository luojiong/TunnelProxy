# TunnelProxy

**TunnelProxy** is an efficient and easy-to-use port forwarding tool that supports bidirectional port mapping: both forwarding remote server ports to local ports and mapping local ports to remote servers. It enables developers to securely establish tunnel connections between local and remote servers. The tool also supports Chrome DevTools Inspector for real-time debugging, making it a perfect solution for remote service testing and development.

## Introduction

TunnelProxy simplifies the connection process between local and remote services, supporting two modes: forward tunneling (remote→local) and reverse tunneling (local→remote), avoiding complex network configurations. It is especially useful for developers who need to interact with remote APIs, databases, or web applications, as well as scenarios requiring local services to be accessible remotely. The added support for Chrome DevTools Inspector allows you to debug and optimize your services directly on your local machine, streamlining your workflow.

[中文版](./README-zh.md)

## Key Features

- 🔌 **Forward Port Tunneling**: Direct connection forwarding from remote hosts to local ports for easy access to remote services.
- 🔄 **Reverse Port Tunneling**: SSH reverse tunneling to map local ports to remote servers, allowing remote access to local services.
- 🖥️ **Graphical User Interface**: Clean and intuitive interface with mode switching support for easy configuration.
- 🔐 **Multiple Authentication Methods**: Supports both SSH password and key-based authentication for secure connections.
- ⏱️ **Real-Time Status Updates**: Displays the status of port forwarding processes in real-time, showing success or failure.
- 🛠️ **Chrome DevTools Inspector Support**: Use Chrome's Developer Tools to debug and inspect locally mapped remote ports in real-time, including HTTP request inspection, JavaScript debugging, and network analysis.
- 📱 **Multiple Port Forwarding**: Supports managing multiple forwarding rules simultaneously for handling multiple services.
- 💾 **Rule Persistence**: Automatically saves forwarding rules and restores active connections after application restart.

## Use Cases

### Forward Tunneling (Remote→Local)
- 💻 **Development & Debugging**: Map remote services to local ports and leverage Chrome DevTools for debugging and inspection.
- 🗄️ **Database Access**: Securely access remote databases without exposing database ports to the public internet.
- 🧪 **Testing Environment**: Quickly access remote testing environment services, reducing network configuration complexity.

### Reverse Tunneling (Local→Remote)
- 🌐 **Local Service Showcase**: Temporarily expose locally developed web applications for remote team member access.
- 🔗 **Webhook Testing**: Allow remote services (like GitHub Webhooks) to access local development environments.
- 📱 **Mobile Debugging**: Enable remote devices to access local development servers for testing.
- 🏠 **NAT Traversal**: Expose internal network services to external access through jump servers.

## Why Choose TunnelProxy?

- ✅ **Simple and Easy to Use**: No complex configurations required, just a clean and intuitive interface to get you up and running quickly.
- 🔒 **Secure and Stable**: Uses SSH tunneling for secure and stable port forwarding.
- ⚙️ **Real-Time Debugging**: With Chrome DevTools Inspector support, you can debug, inspect, and optimize remote services mapped to local ports, enhancing your development workflow.
- ⏳ **Time-Saving**: No need for manual configuration of servers or networks. TunnelProxy provides an easy, quick, and secure solution to map remote services locally.

## Usage Guide

### Forward Tunneling Configuration
1. Select "Forward" mode
2. Enter remote host address (IP or domain)
3. Enter remote port and local port
4. Click "Add Forward" to establish connection

### Reverse Tunneling Configuration
1. Select "Reverse SSH" mode
2. Fill in the following information:
   - **SSH Host**: Target server IP address or domain
   - **SSH User**: Server login username
   - **SSH Password**: Corresponding login password
   - **SSH Port**: SSH service port (default 22)
   - **Remote Port**: Port to listen on the remote server
   - **Local Port**: Local service port
3. Click "Add Forward" to establish reverse tunnel

### ⚠️ Important: Server Configuration Requirements

Before using reverse SSH functionality, ensure the target server's SSH configuration is correct:

1. **Edit SSH configuration file**:
   ```bash
   sudo nano /etc/ssh/sshd_config
   ```

2. **Ensure the following configuration**:
   ```bash
   # Allow TCP forwarding
   AllowTcpForwarding yes
   
   # If external access is needed (optional)
   GatewayPorts yes
   ```

3. **Reload SSH service**:
   ```bash
   sudo systemctl reload sshd
   ```

**Notes**:
- `AllowTcpForwarding yes` is required to enable port forwarding functionality
- `GatewayPorts yes` is optional, only needed when external network access to forwarded ports is required
- Most servers have `AllowTcpForwarding` enabled by default, but some security-hardened servers may have it disabled

## Preview

<image src="./preview.png" alt="preview" />