# 京路

GitHub Pages 地址：https://jasonzhang1986.github.io/jinglu/

## 摄像头更新

- 仓库每天北京时间 05:17 自动抓取进京网的公开摄像头数据。GitHub 调度可能延迟，也可在 Actions → Update camera snapshot → Run workflow 手动执行。
- 浏览器首次打开会拉取已发布的 `cameras.json`；距上次成功检查达到 **24 小时**后，再次打开或回到页面会绕过 HTTP 缓存检查新快照。24 小时内使用浏览器缓存。底部“更新”按钮随时可手动检查。
- 缓存仅包含公开摄像头点位和检查时间，不包含用户位置、目的地或路线。缓存不可用时仍可在线使用。
- 网络失败或数据校验失败会保留旧快照，不会把检查时间误记为成功；页面会显示失败提示，下一次打开可以重试。
- 数据变化后会重建地图点位及避让索引，旧路线被清除并提示重新规划；地图标注、说明与 GeoJSON 导出的数据日期均动态更新。

GitHub Pages 是静态托管，浏览器不能直接跨域抓取来源网站，因此“检查更新”指检查仓库**最新已发布快照**，不保证来源一发布就立即可用。

## 同步脚本与验证

```sh
python3 update_cameras.py
node --test camera-data.test.js
python3 -m unittest test_update_cameras.py
```

同步脚本不执行来源网页的脚本。来源日期倒退、记录解析不完整、点位数量异常下降时会终止并保留旧文件。GitHub Actions 只使用仓库自带的短期 `GITHUB_TOKEN`，无需个人访问令牌。更新提交后显式请求 Pages 重建，以兼容当前“从 main 分支根目录发布”的设置。

自动工作流文件必须位于默认分支且允许 Actions 运行。GitHub 可能在公共仓库连续 60 天没有活动后停用定时工作流，届时需在 Actions 重新启用。若将 Pages 发布源改成自定义 Actions 工作流，需同时修改发布步骤。

地图、地点联想与算路仍使用 OpenStreetMap / Photon / OSRM / Valhalla。摄像头数据是公开快照，可能存在遗漏，不能保证实际道路上没有摄像头。高德分享会重新算路，无法继承本站完整轨迹与摄像头避让规则。
