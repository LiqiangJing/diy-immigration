import Legal from "@/components/Legal";
import { PACKS, SCHOLAR_COST, SIGNUP_BONUS } from "@/lib/server/credits";

export const metadata = {
  title: "产品介绍与价格 · DIY Immigration",
  description: "DIY Immigration 是一款在线软件工具：用 AI 帮你整理材料、起草和修改美国 NIW / EB-1A 申请文书。按用量付费，购买的是软件使用额度（credits）。",
};

/** 公开的产品介绍页：这个网站是什么、卖的是什么、多少钱、怎么退款、怎么联系。不登录也能看。 */
export default function About() {
  return (
    <Legal title="产品介绍与价格" updated="2026 年 11 月 26 日">
      <h2>一、DIY Immigration 是什么</h2>
      <p>
        DIY Immigration 是一款<strong>在线软件工具</strong>（AI 写作与材料整理助手）。它面向打算<strong>自己准备</strong>美国 NIW（国家利益豁免）或
        EB-1A（杰出人才）申请材料的科研人员和专业人士，帮他们整理自己的背景和证据、起草和修改文书、把材料打包成一份文件。
      </p>
      <p>打开网页就能用，不需要下载安装。注册只需要一个邮箱。</p>

      <h2>二、主要功能</h2>
      <ul>
        <li><strong>AI 问答</strong>：结合你填写的背景，回答准备申请过程中的问题。</li>
        <li><strong>档案整理</strong>：学历、论文、项目和未来计划，可以手动填，也可以在聊天里说一句让它整理成卡片，确认后填入。</li>
        <li><strong>学术数据与引用分析</strong>：获取公开的论文和引用数据，找出引用你论文的原句并分类，生成引用地图。</li>
        <li><strong>申请向导和材料清单</strong>：每个案件一步一步提示该准备什么、还差什么。</li>
        <li><strong>文书起草与修改</strong>：用你自己的材料起草申请信、推荐信草稿等文档，可以让它按你的意见反复修改。</li>
        <li><strong>材料打包</strong>：把文书和证据文件按顺序编号，合成一份带目录和页码的 PDF。</li>
      </ul>
      <p>
        想先看看实际界面，可以打开<a href="/demo">功能演示</a>。
      </p>

      <h2>三、收费方式与价格</h2>
      <p>
        本站出售的是<strong>软件使用额度（credits）</strong>，属于虚拟商品：付款成功后自动到账，只在本站内使用，没有实物，不需要发货。
        没有月费或会员费，用多少扣多少。
      </p>
      <table className="price-table">
        <thead>
          <tr>
            <th>充值档位</th>
            <th>价格（人民币）</th>
            <th>到账 credits</th>
          </tr>
        </thead>
        <tbody>
          {PACKS.map((p) => (
            <tr key={p.id}>
              <td>{p.credits} credits</td>
              <td>¥{p.cny}</td>
              <td>
                {p.credits}
                {p.credits > p.usd * 100 && `（含赠送 ${p.credits - p.usd * 100}）`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Credits 的消耗按每次实际用量计算，内容越长消耗越多。大致范围：</p>
      <ul>
        <li>聊天提问：每条通常十几到几十个 credits；</li>
        <li>起草或修改一封申请信、推荐信：每次约 200–300 个；</li>
        <li>获取学术数据：每次 {SCHOLAR_COST} 个；重要引用分析：每篇论文约 50–250 个。</li>
      </ul>
      <p>
        新用户注册赠送 {SIGNUP_BONUS} credits（每日名额有限），可以先试用再决定是否充值。每一笔消耗都能在「账户」页的流水里看到。
      </p>

      <h2>四、付款与退款</h2>
      <ul>
        <li>付款方式：支付宝。登录后在「账户」页选择充值档位，跳转到支付宝完成付款，credits 随即到账。</li>
        <li>
          退款：购买后 7 天内，尚未使用的 credits 可以通过「联系我们」申请退款；已经消耗的 credits 不退。因系统故障被错误扣除的
          credits，核实后补回。完整规则见<a href="/terms">服务条款</a>。
        </li>
      </ul>

      <h2>五、我们不做什么</h2>
      <ul>
        <li>我们只提供软件工具，<strong>不是移民中介，也不是律师事务所</strong>。</li>
        <li>不代办、不代为递交任何申请，不提供法律意见，不承诺申请结果。</li>
        <li>所有申请材料都由用户本人准备、核对、签署和递交。案情复杂的，建议咨询有执照的移民律师。</li>
      </ul>

      <h2>六、联系我们</h2>
      <p>
        使用问题、充值没到账、退款或建议，都可以在<a href="/">首页</a>左侧点「联系我们」留言，我们会回复到你留下的邮箱；也可以用微信扫下面的码添加我们的企业微信。
      </p>
      {/* 和「联系我们」弹窗里是同一张图 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="about-qr" src="/wechat-qr.png" alt="企业微信二维码" />
    </Legal>
  );
}
