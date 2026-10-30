import app from './app.js'

const PORT = process.env.PORT || 3020

app.listen(PORT, () => console.log(`✅ 个人财务后端已启动：http://localhost:${PORT}`))
