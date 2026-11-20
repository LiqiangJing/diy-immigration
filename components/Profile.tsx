"use client";

import { DEGREE_TYPES, REVIEW_OPTIONS } from "@/lib/profile";
import type { Degree, Profile as ProfileData, Related } from "@/lib/profile";
import { uid } from "@/lib/types";

type Props = {
  profile: ProfileData;
  setProfile: React.Dispatch<React.SetStateAction<ProfileData>>;
};

const newDegree = (type = ""): Degree => ({
  id: uid(),
  type,
  major: "",
  university: "",
  year: "",
  related: "",
});

function Radio<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="radios">
      {options.map((o) => (
        <label key={o.value}>
          <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function DegreeFields({
  d,
  onChange,
  onRemove,
  enrolled,
}: {
  d: Degree;
  onChange: (d: Degree) => void;
  onRemove: () => void;
  enrolled?: boolean;
}) {
  const set = (patch: Partial<Degree>) => onChange({ ...d, ...patch });
  return (
    <div className="degree">
      <div className="grid2">
        <label>
          学位类型
          {enrolled ? (
            <input value={d.type} onChange={(e) => set({ type: e.target.value })} placeholder="如 PhD (in progress)" />
          ) : (
            <select value={d.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="">请选择</option>
              {DEGREE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          )}
        </label>
        <label>
          专业
          <input value={d.major} onChange={(e) => set({ major: e.target.value })} />
        </label>
        <label>
          学校
          <input value={d.university} onChange={(e) => set({ university: e.target.value })} />
        </label>
        <label>
          {enrolled ? "预计毕业时间" : "学位授予年份"}
          <input
            value={d.year}
            onChange={(e) => set({ year: e.target.value })}
            placeholder={enrolled ? "MM/YYYY" : "YYYY"}
            inputMode="numeric"
          />
        </label>
      </div>
      <div className="field">
        <span>这个学位和你拟从事的事业（或未来在美工作）相关吗？</span>
        <Radio<Related>
          name={`rel-${d.id}`}
          value={d.related}
          onChange={(related) => set({ related })}
          options={[
            { value: "yes", label: "相关" },
            { value: "no", label: "不相关" },
            { value: "unsure", label: "不确定" },
          ]}
        />
      </div>
      <button className="link-danger" onClick={onRemove}>
        移除
      </button>
    </div>
  );
}

export default function Profile({ profile: p, setProfile }: Props) {
  const set = (patch: Partial<ProfileData>) =>
    setProfile((prev) => ({ ...prev, ...patch, updatedAt: Date.now() }));

  return (
    <div className="cases profile">
      <div className="case-head">
        <div>
          <h2>My Profile</h2>
          <p>
            填写你的背景。AI 在聊天和评估案件时会参考这份档案，不用每次重新介绍自己。
            {p.updatedAt > 0 && <> 上次更新：{new Date(p.updatedAt).toLocaleString("zh-CN")}（自动保存）</>}
          </p>
        </div>
      </div>

      <section className="card">
        <h3>基本信息</h3>
        <div className="grid2">
          <label>
            First Name（名）
            <input value={p.firstName} onChange={(e) => set({ firstName: e.target.value })} />
          </label>
          <label>
            Last Name（姓）
            <input value={p.lastName} onChange={(e) => set({ lastName: e.target.value })} />
          </label>
        </div>
        <label>
          研究 / 工作领域
          <input
            value={p.field}
            onChange={(e) => set({ field: e.target.value })}
            placeholder="如：多模态大模型、电池材料、肿瘤免疫"
          />
        </label>
      </section>

      <section className="card">
        <h3>学历</h3>
        <p className="group-note">列出你已经获得的所有学位。</p>
        {p.degrees.map((d) => (
          <DegreeFields
            key={d.id}
            d={d}
            onChange={(nd) => set({ degrees: p.degrees.map((x) => (x.id === d.id ? nd : x)) })}
            onRemove={() => set({ degrees: p.degrees.filter((x) => x.id !== d.id) })}
          />
        ))}
        <button className="btn-ghost" onClick={() => set({ degrees: [...p.degrees, newDegree()] })}>
          + 添加学位
        </button>

        <h4>在读的高等学位</h4>
        {p.enrolled ? (
          <DegreeFields enrolled d={p.enrolled} onChange={(enrolled) => set({ enrolled })} onRemove={() => set({ enrolled: null })} />
        ) : (
          <button className="btn-ghost" onClick={() => set({ enrolled: newDegree("PhD (in progress)") })}>
            + 我目前在读高等学位
          </button>
        )}
      </section>

      <section className="card">
        <h3>学术记录</h3>
        <label>
          引用数据库链接（Google Scholar、ResearchGate 等）
          <small>请确认主页是公开的，并且里面的文章都确实是你的。</small>
          <input
            type="url"
            value={p.scholarUrl}
            onChange={(e) => set({ scholarUrl: e.target.value })}
            placeholder="https://scholar.google.com/citations?user=..."
          />
        </label>
        <div className="grid2">
          <label>
            论文数
            <input value={p.papers} onChange={(e) => set({ papers: e.target.value })} inputMode="numeric" />
          </label>
          <label>
            总引用数
            <input value={p.citations} onChange={(e) => set({ citations: e.target.value })} inputMode="numeric" />
          </label>
        </div>
        <div className="field">
          <span>
            审稿次数
            <small>以感谢信或审稿证明为准，同一稿件的多轮审稿可分别计数。</small>
          </span>
          <Radio
            name="reviews"
            value={p.reviews}
            onChange={(reviews) => set({ reviews })}
            options={REVIEW_OPTIONS.map((v) => ({ value: v, label: v }))}
          />
        </div>
      </section>

      <section className="card">
        <h3>工作与未来计划</h3>
        <label>
          当前在美职位
          <small>如 PhD student at UT Dallas, TX；Software Engineer at Amazon, WA。不在美国或待业填 N/A。</small>
          <input value={p.currentPosition} onChange={(e) => set({ currentPosition: e.target.value })} />
        </label>

        <div className="field">
          <span>
            未来在美工作，是否仍在同一或相近领域？
            <small>除非未来 6 个月内打算换工作，否则当前职位就视为你的拟从事工作。</small>
          </span>
          <Radio
            name="sameField"
            value={p.sameField}
            onChange={(sameField) => set({ sameField })}
            options={[
              { value: "yes", label: "是，继续在积累了主要成果的领域工作" },
              { value: "no", label: "否，我换了领域" },
            ]}
          />
          {p.sameField === "no" && (
            <div className="grid2">
              <label>
                原领域
                <input value={p.fieldFrom} onChange={(e) => set({ fieldFrom: e.target.value })} />
              </label>
              <label>
                新领域
                <input value={p.fieldTo} onChange={(e) => set({ fieldTo: e.target.value })} />
              </label>
            </div>
          )}
        </div>

        <div className="field">
          <span>
            是否仍在做与拟从事事业一致的研究并发表论文？
            <small>持续的产出能说明你仍活跃在该领域，有能力推进拟从事的事业。</small>
          </span>
          <Radio
            name="activeResearch"
            value={p.activeResearch}
            onChange={(activeResearch) => set({ activeResearch })}
            options={[
              { value: "yes", label: "是，仍在做研究并发表" },
              { value: "no", label: "否，已不再做研究或发表" },
            ]}
          />
          {p.activeResearch === "yes" && (
            <label>
              预计下一篇论文发表时间
              <input value={p.nextPaper} onChange={(e) => set({ nextPaper: e.target.value })} placeholder="MM/YYYY" />
            </label>
          )}
        </div>
      </section>

      <p className="disclaimer">档案只保存在你当前的浏览器里；聊天时会随消息发送给 AI。</p>
    </div>
  );
}
