/**
 * 美国「关键和新兴技术」（Critical and Emerging Technologies, CET）清单。
 * 出处：白宫科技政策办公室（OSTP）2026 年 8 月发布的 National Security Science and Technology Strategy，附录 A（第 20–22 页）。
 * 大类和子项的英文是原文照录；子项只是举例说明范围，原文注明并非穷尽。清单更新后要同步改这里。
 */
export const CET_SOURCE = {
  title: "National Security Science and Technology Strategy（2026 年 8 月），附录 A",
  url: "https://www.whitehouse.gov/wp-content/uploads/2026/08/NSSTS-082026.pdf",
  pages: "第 20–22 页",
};

export const CET: { area: string; zh: string; subs: string[] }[] = [
  {
    "area": "Advanced manufacturing and materials",
    "zh": "先进制造与材料",
    "subs": [
      "Advanced additive manufacturing beyond prototyping, especially for metals, ceramics, and large-scale structures",
      "Smart manufacturing and use of digital threads and digital twins",
      "Nanomanufacturing",
      "Materials by design utilizing AI and autonomous development and production",
      "High entropy alloys",
      "Advanced composites and lightweight metals",
      "Materials with novel, tailored, and improved properties, including biomaterials and substitution of rare-earth or critical minerals-based alloys with earth-abundant minerals"
    ]
  },
  {
    "area": "Artificial intelligence (AI) and autonomy",
    "zh": "人工智能与自主系统",
    "subs": [
      "Perception, recognition, and sensor fusion",
      "Planning, reasoning, and decision-making",
      "Robotics and embodied intelligence",
      "Foundation models, including large language, multimodal, and world systems",
      "Multi-agent systems and swarm intelligence",
      "Autonomous systems for surface, air, maritime, space, and cyber domains",
      "Autonomous command and control",
      "Autonomous agent identification and authentication",
      "Interpretability and control",
      "Adversarial robustness and AI security",
      "Techniques to enable next-generation AI systems, such as continual learning",
      "Distributed and privacy-preserving machine learning"
    ]
  },
  {
    "area": "Biotechnology",
    "zh": "生物技术",
    "subs": [
      "Novel synthetic biology including nucleic acid synthesis; genome and epigenome engineering; protein design, synthesis, and engineering; and computational modeling",
      "Engineering of sub-cellular, multicellular, multi-scale, cell-free, and viral systems",
      "Novel therapeutic design and manufacturing",
      "Biotic/abiotic interfaces and novel materials",
      "Biomanufacturing and bioprocessing technologies",
      "Neurotechnologies"
    ]
  },
  {
    "area": "Communications and networking",
    "zh": "通信与网络",
    "subs": [
      "Future generation wireless networks",
      "Optical links and fiber technologies",
      "Spectrum access technologies",
      "Software-defined networking and radios",
      "Modern data exchange techniques",
      "Adaptive network controls",
      "Resilient and path-diverse communications, including delay-tolerant and infrastructure-independent networking, adaptive waveforms, and space and stratospheric modalities"
    ]
  },
  {
    "area": "Directed energy",
    "zh": "定向能",
    "subs": [
      "Lasers",
      "High-power microwaves",
      "Particle beams"
    ]
  },
  {
    "area": "Future computing technologies",
    "zh": "未来计算技术",
    "subs": [
      "Advanced and next-generation computing architectures",
      "Photonic, neuromorphic, and other non-Von Neumann computing modalities",
      "High-performance supercomputing, including for AI applications",
      "Edge computing and devices for tactical environments",
      "Brain-computer interfaces",
      "Enabling technologies for high security computing",
      "Hardened operating systems for consumer use",
      "Advanced spatial computing"
    ]
  },
  {
    "area": "Hypersonics and advanced missile technologies",
    "zh": "高超音速与先进导弹技术",
    "subs": [
      "Propulsion",
      "Aerodynamics and control",
      "Materials, structures, and manufacturing",
      "Testing",
      "Detection, tracking, characterization, and defense"
    ]
  },
  {
    "area": "Information management and cybersecurity",
    "zh": "信息管理与网络安全",
    "subs": [
      "Data management, including storage and security",
      "AI-enabled and autonomous cyber capabilities",
      "Distributed ledger technologies and digital assets",
      "Digital identity technologies and biometrics",
      "Computing supply chain security and assurance",
      "Communications, network, and cyber-physical systems security",
      "Post-quantum cryptography",
      "Operational technology and industrial control system security and resilience"
    ]
  },
  {
    "area": "Nuclear energy",
    "zh": "核能",
    "subs": [
      "Advanced fission reactors",
      "Fusion energy",
      "Space nuclear power and propulsion systems",
      "High-temperature and radiation resistant materials"
    ]
  },
  {
    "area": "Positioning, navigation, and timing (PNT)",
    "zh": "定位、导航与授时",
    "subs": [
      "Diversified PNT-enabling technologies for airborne, space-based, terrestrial, subterranean, and underwater settings",
      "Interference, jamming, and spoofing detection",
      "Disruption/denial-resisting and hardening technologies",
      "Chip-scale frequency standards, inertial sensors, and atomic clocks"
    ]
  },
  {
    "area": "Quantum information technologies",
    "zh": "量子信息技术",
    "subs": [
      "Quantum computing",
      "Quantum sensing",
      "Quantum communications and networking",
      "Enabling components, algorithms, materials, and fabrication techniques"
    ]
  },
  {
    "area": "Semiconductors and microelectronics",
    "zh": "半导体与微电子",
    "subs": [
      "Design automation tools",
      "Advanced manufacturing process technologies and equipment",
      "Beyond complementary metal-oxide-semiconductor (CMOS) technology",
      "Heterogeneous integration and advanced packaging",
      "Specialized hardware components for AI, RF and optical applications, elevated radiation environments, high-power devices, and other critical applications",
      "Novel materials for advanced microelectronics, including 2D materials",
      "Microelectromechanical and Nanoelectromechanical systems (MEMS and NEMS)",
      "Integrated photonics"
    ]
  },
  {
    "area": "Sensing and signature management",
    "zh": "传感与特征管理",
    "subs": [
      "Advanced sensors and sensor systems, including distributed apertures",
      "Data processing and fusion",
      "Adaptive optics",
      "Detection and characterization of pathogens and of chemical, biological, radiological, and nuclear weapons and threat materials"
    ]
  },
  {
    "area": "Space technologies",
    "zh": "空间技术",
    "subs": [
      "Cost-effective on-demand and reusable space launch",
      "Advanced space vehicle power generation and propulsion",
      "Novel space vehicle thermal management",
      "Access to and use of cislunar space and novel orbits",
      "In-space aggregation and assembly",
      "Biotechnologies for space applications",
      "Crewed spaceflight enablers"
    ]
  }
];
