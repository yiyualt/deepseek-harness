# DeepSeek Harness 同账号云端同步实施规划

状态：仅规划，尚未实现

## 目标

用户在电脑端和云端使用同一账号后，可以查看并继续相同的聊天会话，并在所有设备上读取和修改同一份长期用户记忆。云端是共享数据的权威来源，本地保留可重建的缓存，但不得通过复制正在使用的 JSONL 或 SQLite 文件实现同步。

## 用户体验

1. 用户在电脑端登录账号。
2. 电脑端连接云端 DeepSeek Harness，并获取该账号的会话列表与用户记忆。
3. 用户在任一设备创建或继续会话；提交成功后，其他设备重新连接即可读取最新记录。
4. 用户记忆独立于单个会话，在同一账号的所有会话和设备之间共享。
5. 另一账号不能列出、读取、续写或删除该账号的会话、附件和记忆。

## 总体架构

```text
电脑端 DeepSeek Harness
  ├─ 本地 UI / Agent Runtime
  ├─ 本地会话与记忆缓存
  └─ Device Sync Provider
             │ HTTPS + Bearer Token
             ▼
云端 DeepSeek Harness
  ├─ Account Authentication
  ├─ Sync API
  ├─ Session Authority
  │    ├─ Session owner
  │    ├─ revision
  │    └─ writer lease
  ├─ User Memory Authority
  └─ 持久化
       ├─ SessionEvent 日志
       ├─ UserMemory 记录
       └─ 附件与投影数据
```

电脑端与云端不是两套独立账号，也不互相覆盖文件。两端提交的凭据必须解析为相同的 `UserId`，云端根据 `UserId` 授权并返回同一数据集。

## 核心数据

### 账号

`UserId` 是经过身份 Provider 认证的稳定账号标识，与当前仅用于匿名关联的 `AnonymousUserId` 分离。Token 通过 credentials 引用按请求解析，不写入 Cordis 配置、SessionEvent、诊断日志或同步载荷。

### 会话

每个云端会话记录以下元数据：

```ts
interface AccountSessionHeader {
  sessionId: SessionId
  ownerId: UserId
  revision: number
  createdAt: number
  updatedAt: number
}
```

`revision` 表示云端已经接受的完整事件前缀。续写请求携带 `baseRevision`；只有它等于云端当前 revision 且调用者持有有效 writer lease 时，云端才接受追加并返回新 revision。冲突请求返回当前 revision，不执行覆盖或按时间戳合并。

### 用户记忆

用户记忆是账号级数据，不属于任何单个会话：

```ts
interface UserMemoryRecord {
  id: UserMemoryId
  ownerId: UserId
  content: string
  revision: number
  createdAt: number
  updatedAt: number
}
```

修改与删除携带 `expectedRevision`。过期 revision 返回冲突和当前记录。模型使用记忆时，系统把当次选择的精确记忆快照写入 SessionEvent，使历史请求不依赖记忆的当前内容。

## 同步协议

第一版使用有界 HTTPS 请求，不直接同步持久化文件。建议的业务操作如下：

```text
GET    /sync/sessions?cursor=...
GET    /sync/sessions/{sessionId}?fromRevision=...
POST   /sync/sessions/{sessionId}/lease
POST   /sync/sessions/{sessionId}/append
DELETE /sync/sessions/{sessionId}/lease

GET    /sync/memories?cursor=...
POST   /sync/memories
PUT    /sync/memories/{memoryId}
DELETE /sync/memories/{memoryId}
```

所有操作先验证 bearer token，再从认证结果获取 `UserId`。请求参数不得指定或覆盖 owner。服务端限制完整请求与响应大小，支持 AbortSignal，并在写入持久存储成功后推进 cursor 或 revision。

## 写入与冲突规则

- 云端是会话事件顺序的唯一权威。
- 一个活动会话同时只有一个可续期 writer lease。
- 其他设备可以立即读取，但必须等待 lease 释放或过期后才能接管写入。
- 会话追加必须保持连续 `SessionEvent.seq`。
- 会话分支冲突直接拒绝，不执行 last-write-wins 或语义合并。
- 用户记忆使用逐记录 compare-and-swap，不使用会话 writer lease。
- 断网期间本地可以读取已经同步的完整前缀；第一版不允许离线创建需要稍后自动合并的会话分支。

## 包与职责规划

| 规划组件 | 职责 |
|---|---|
| Account Service Definition | 提供当前主体、外发 token 和传入 bearer token 验证 |
| Development Account Provider | 通过 credential reference 提供一个开发账号 |
| User Memory Service Definition / Provider / Consumer | 账号记忆的持久化、修改冲突和模型上下文快照 |
| Account Session Ownership | 在创建、读取、恢复、fork、追加、附件和查询路径验证 owner |
| Sync Service Definition | 定义会话、记忆、cursor、revision 和 lease 操作 |
| Cloud Sync Provider | 使用云端权威持久化实现同步操作 |
| Device Sync Provider | 管理本地缓存、reconnect cursor 和上传状态 |
| HTTPS Sync Consumer | 暴露鉴权、限流和有界请求/响应的远程接口 |

每项 capability 需要完整的 Service Definition、Provider 和 Consumer 角色；不得把同步逻辑直接写入 agent loop。

## 实施阶段

### 阶段 1：身份与所有权

- 定义经过认证的 `UserId` 和 Account Provider。
- 为云端会话建立不可变 owner 记录。
- 在所有会话、附件、投影和查询入口增加账号授权。
- 为无 owner 的本地历史提供显式导入操作，不允许首次访问者自动认领。

### 阶段 2：账号用户记忆

- 实现 `UserMemoryRecord`、持久化 domain 和 revision-checked CRUD。
- 在模型请求准备阶段选择有界记忆快照。
- 将精确快照记录为模型可重建的 SessionEvent。

### 阶段 3：云端会话权威

- 实现 session revision、连续 append 和 writer lease。
- 实现取消、超时、请求大小和响应大小限制。
- 覆盖 lease 续期、释放、过期接管和 revision 冲突。

### 阶段 4：设备同步

- 实现本地持久缓存、同步 cursor 和断线重连。
- 下载账号会话、事件增量和记忆变更。
- 成功提交云端后再更新本地已同步 revision。
- 缓存损坏时从云端完整重建，不复制云端数据库文件。

### 阶段 5：产品组合与部署

- 提供一个单账号开发用的云端配置和电脑端配置。
- 将 Token 放入 credential provider，不写入 YAML。
- 记录反向代理、TLS、数据目录、备份和恢复要求。
- 后续用生产身份 Provider、PostgreSQL 和对象存储替换开发 Provider，不改变业务接口。

## 验收条件

- 两个 Harness home 使用同一账号时可以列出并恢复相同会话。
- 另一账号无法访问会话、事件、附件、投影和记忆。
- 电脑端提交的 turn 在云端持久化后，可以由另一设备增量读取。
- 两个设备并发续写同一会话时，一个提交成功，另一个收到明确的 lease 或 revision 冲突。
- 冲突后云端 SessionEvent 日志仍保持连续。
- 用户记忆的创建、更新、删除和重连同步保持稳定 id 与单调 revision。
- 每次进入模型请求的记忆快照都能从对应 Session log 重建。
- 真实 Loader 组合测试覆盖电脑端和云端 Provider。
- keyless snapshot 展示共享记忆对模型请求产生影响。

## 测试规划

- 单元测试：账号隔离、Token 轮换、revision、lease、cursor、取消和大小限制。
- Provider contract：云端和设备 Provider 通过同一套同步行为测试。
- Loader composition：使用真实包入口启动单账号电脑端与云端组合。
- Snapshot：运行真实示例并固定账号记忆进入模型上下文的 transcript。
- 故障测试：存储提交失败、重复请求、断线重连、过期 lease 和损坏缓存重建。

## 暂不包含

- 多主会话写入和自动分支合并。
- 脱机执行工具后再自动合并副作用。
- 生产注册、密码找回、组织和成员管理。
- 多区域主动写入和水平调度。
- 记忆的语义检索、自动提取和遗忘策略。

## 开始编码前的确认项

- 确认第一版电脑端是完整本地 Agent Runtime，还是仅作为云端 Runtime 的 UI 客户端。
- 确认云端第一版继续使用现有 JSONL/domain storage，还是直接采用 PostgreSQL。
- 确认单账号开发 Provider 的 credential 名称和部署方式。
- 确认历史 ownerless session 的导入入口和默认可见范围。
