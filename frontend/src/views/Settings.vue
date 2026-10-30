<template>
  <div class="page">
    <div class="page-head"><div><div class="page-title">系统设置</div></div></div>
    <el-row :gutter="14">
      <el-col :xs="24" :lg="12">
        <div class="section-title" style="margin-top: 0">AI 辅助录入</div>
        <div class="table-card pad">
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="状态">
              <el-tag :type="ai.enabled ? 'success' : 'warning'">{{ ai.enabled ? '可用' : '未启用' }}</el-tag>
              <span class="muted" style="margin-left: 8px">{{ ai.hint }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="通道">{{ ai.provider }}</el-descriptions-item>
            <el-descriptions-item label="模型">{{ ai.model || '—' }}</el-descriptions-item>
          </el-descriptions>
          <div class="muted help">
            在 <code>backend/.env</code> 里切换：<br />
            <code>AI_PROVIDER=platform</code> 以虎 One 平台大模型，部署到平台时默认走这个<br />
            <code>AI_PROVIDER=claude-cli</code>（本机默认）复用本机已登录的 claude 命令行，不需要 Key；<code>AI_CLI_MODEL</code> 可设 haiku（快）或 sonnet（准）<br />
            <code>AI_PROVIDER=anthropic</code> 用 <code>ANTHROPIC_API_KEY</code> 直连，部署到其他服务器时用这个<br />
            <code>AI_PROVIDER=off</code> 关闭 AI，只用规则解析「今天午饭 45 微信」这类简单句子
          </div>
        </div>
      </el-col>
      <el-col :xs="24" :lg="12">
        <div class="section-title" style="margin-top: 0">修改密码</div>
        <div class="table-card pad">
          <el-form label-width="80px">
            <el-form-item label="原密码"><el-input v-model="pwd.oldPassword" type="password" show-password /></el-form-item>
            <el-form-item label="新密码"><el-input v-model="pwd.newPassword" type="password" show-password /></el-form-item>
            <el-button type="primary" @click="changePwd">修改</el-button>
          </el-form>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/api'

const ai = ref({})
const pwd = reactive({ oldPassword: '', newPassword: '' })
async function changePwd() {
  try { await api.auth.changePassword(pwd); ElMessage.success('已修改'); pwd.oldPassword = pwd.newPassword = '' } catch (e) { ElMessage.error(e.message) }
}
onMounted(async () => { ai.value = await api.ai.status() })
</script>

<style scoped>
.pad { padding: 14px; }
.help { font-size: 12px; line-height: 2; margin-top: 12px; }
code { background: #f2f0eb; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
@media (max-width: 768px) {
  .help { font-size: 14px; line-height: 1.8; }
  code { font-size: 14px; word-break: break-all; }
}
</style>
