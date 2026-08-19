---
permalink: /
title: ""
excerpt: ""
author_profile: true
redirect_from: 
  - /about/
  - /about.html
---

{% if site.google_scholar_stats_use_cdn %}
{% assign gsDataBaseUrl = "https://cdn.jsdelivr.net/gh/" | append: site.repository | append: "@" %}
{% else %}
{% assign gsDataBaseUrl = "https://raw.githubusercontent.com/" | append: site.repository | append: "/" %}
{% endif %}
{% assign url = gsDataBaseUrl | append: "google-scholar-stats/gs_data_shieldsio.json" %}

<span class='anchor' id='about-me'></span>

I am a PhD candidate in the Department of Geography at the University of Colorado Boulder, advised by <a href='https://www.colorado.edu/geography/guofeng-cao'>Dr. Guofeng Cao</a> at <a href="https://www.spatstat.com/">Spatiotemporal Pattern Analysis & Research Laboratory (STARlab)</a>.

My research focuses on developing spatially-explicit deep learning (GeoAI) methods to support uncertainty-aware knowledge discovery and decision-making in geospatial applications. I am also interested in the applications of large language models (LLMs), pre-trained foundation models, and physics-informed machine learning in geospatial data analysis and modeling.

I have a strong background in geospatial data analysis, machine learning, and remote sensing. I am passionate about advancing the field of GeoAI and contributing to the development of innovative solutions for geospatial challenges.

<!-- # 🔥 News
- *2022.02*: &nbsp;🎉🎉 Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus ornare aliquet ipsum, ac tempus justo dapibus sit amet. 
- *2022.02*: &nbsp;🎉🎉 Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus ornare aliquet ipsum, ac tempus justo dapibus sit amet.  -->

# 📖 Education

- *2025 - now*, PhD candidate, Department of Geography, University of Colorado Boulder
- *2021 - 2025*, PhD student, Department of Geography, University of Colorado Boulder
- *2020 - 2021*, PhD student, Department of Geosciences, Texas Tech University
- *2016 - 2020*, Bachelor of Science in Geographic Information Science, Department of Resources and Environmental Sciences, Hubei University

# 👨‍🏫 Teaching and Research Experiences

**Research Assistant**, Department of Geography, University of Colorado Boulder
- Fall 2021 - Fall 2023, Summer 2024, Summer 2025, Summer 2026
- Developed deep learning-based geostatistical models integrating neural networks with spatial statistical methods for uncertainty-aware geospatial modeling and climate data downscaling under the supervision of Dr. Guofeng Cao.

**Research Assistant**, Department of Geosciences, Texas Tech University
- Fall 2020 - Spring 2021
- Processed, analyzed, and visualized the impact of hurricanes on patient flow in the coastal areas of Texas under the supervision of Dr. Guofeng Cao. [\[Website\]](https://www.spatstat.com/NIST/HarrisHarvey.html)

**Teaching Assistant**, Department of Geography, University of Colorado Boulder
- GEOG 4203: Geographic Information Science: Spatial Modeling (Fall 2025)
- GEOG 4023/5023: Advanced Quantitative Methods (Spring 2024 and Spring 2025)
- GEOG 3023: Statistics and Geographic Data (Fall 2024 and Spring 2026)

# 📝 Publications
(\* indicates corresponding author)

## Peer-Reviewed Journal Articles

<!-- <div class='paper-box'><div class='paper-box-image'><div><div class="badge">CVPR 2016</div><img src='images/500x300.png' alt="sym" width="100%"></div></div>
<div class='paper-box-text' markdown="1">

[Deep Residual Learning for Image Recognition](https://openaccess.thecvf.com/content_cvpr_2016/papers/He_Deep_Residual_Learning_CVPR_2016_paper.pdf)

**Kaiming He**, Xiangyu Zhang, Shaoqing Ren, Jian Sun

[**Project**](https://scholar.google.com/citations?view_op=view_citation&hl=zh-CN&user=DhtAFkwAAAAJ&citation_for_view=DhtAFkwAAAAJ:ALROH1vI_8AC) <strong><span class='show_paper_citations' data='DhtAFkwAAAAJ:ALROH1vI_8AC'></span></strong>
- Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus ornare aliquet ipsum, ac tempus justo dapibus sit amet.
</div>
</div> -->
In Preparation
- ***Li, G.\****, Yu, Z., and Cao, G., 2026. The Perception-Precision Trade-Off in GeoAI. (*Manuscript in Preparation*)

Under Review / In Revision
- ***Li, G.\**** and Cao, G., 2026. Foundation Kriging: A Pretrained Spatial Prior for Zero-Shot Spatial Prediction. (*Under Review*)
- ***Li, G.*** and Cao, G.\*, 2026. Neural Kriging: A Scalable Deep Probabilistic Framework for Uncertainty-Aware Spatial Interpolation Under Data Sparsity. (*Under Review*)
- ***Li, G.\**** and Cao, G., 2026. Bayesian Geospatial Downscaling with Deep Generative Models. (*In Revision*)

Published / Accepted
- Wu, D.\*, Srygley, R., ***Li, G.*** and Cao, G., 2026. Modeling the spatiotemporal dynamics of Mormon crickets across the western United States using Bayesian species distribution models. Ecological Informatics, p.103989. [\[Ecol. Inform.\]](https://www.sciencedirect.com/science/article/pii/S1574954126003961) \| [\[Code\]](https://github.com/thestarlab/Bayesian_SDM_MC) \| [\[Website\]](https://www.spatstat.com/GeoPest_Web/)
- ***Li, G.*** and Cao, G.\*, 2025. Generative adversarial models for extreme geospatial downscaling. *International Journal of Applied Earth Observation and Geoinformation, 139*, p.104541. [\[JAG\]](https://www.sciencedirect.com/science/article/pii/S1569843225001888) \| [\[ArXiv\]](https://arxiv.org/abs/2402.14049) \| [\[Code\]](https://github.com/LiGuiye/LAG_Climate)
- Huang, L.\*, Willis, M.J., ***Li, G.***, Lantz, T.C., Schaefer, K., Wig, E., Cao, G. and Tiampo, K.F., 2023. Identifying active retrogressive thaw slumps from ArcticDEM. *ISPRS Journal of Photogrammetry and Remote Sensing, 205*, pp.301-316. [\[ISPRS\]](https://www.sciencedirect.com/science/article/pii/S0924271623002836) \| [\[Code\]](https://github.com/yghlc/labelEarth)

## Conference Proceedings with Full Paper Review
- ***Li, G.*** and Cao, G.\*, 2024, October. Neural Process for Uncertainty-Aware Geospatial Modeling. In *Proceedings of the 7th ACM SIGSPATIAL International Workshop on AI for Geographic Knowledge Discovery* (pp. 106-109). [\[Paper\]](https://dl.acm.org/doi/abs/10.1145/3687123.3698294) \| [\[Code\]](https://github.com/LiGuiye/LBANP)
- ***Li, G.*** and Cao, G.\*, 2024, October. Statistical Downscaling of Climate Datasets with Deep Generative Model and Bayesian inference. In *Proceedings of the I-GUIDE Forum 2024: Convergence Science and Geospatial AI for Environmental Sustainability*. [\[Paper\]](https://docs.lib.purdue.edu/iguide/2024/presentations/4/)
- ***Li, G.\**** and Cao, G., 2023, September. Bayesian Super-Resolution of Geospatial Datasets with Deep Generative Models. Paper presented at the *Geospatial Knowledge Graphs and GeoAI Workshop, GIScience 2023*, Leeds, UK. [\[Paper\]](https://doi.org/10.17605/OSF.IO/H2AWQ)

# 💬 Conference and Symposium Presentations
(Presenter is in the first position.)

<!-- - *2021.06*, Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus ornare aliquet ipsum, ac tempus justo dapibus sit amet.
- *2021.03*, Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus ornare aliquet ipsum, ac tempus justo dapibus sit amet.  \| [\[video\]](https://github.com/) -->

- Cao, G. and <b><i>Li, G.</i></b>: GeoAI for small geospatial data. CPGIS 2026. Singapore. July 2026
- ***Li, G.***, Yu, Z., and Cao, G.: The Perception-Precision Trade-Off in GeoAI. AAG 2026. San Francisco, CA. March 2026
- <b><i>Li, G.</i></b> and Cao, G.: GeoAI for small geospatial data. AAG 2026. San Francisco, CA. March 2026
- Wu, D., Cao, G., Srygley, R. and <b><i>Li, G.</i></b>: High resolution mapping of Mormon cricket with a Bayesian spatiotemporal species distribution model. AGU 2025. New Orleans, LA. December 2025
- Cao, G. and <b><i>Li, G.</i></b>: GeoAI for small geospatial data. AAG 2025. Detroit, MI. March 2025
- Cao, G., Srygley, R., <b><i>Li, G.</i></b>, Wu, D. and Branson, D.: GeoAI for Grasshopper Outbreak Risk Mapping in the Western United States. AGU 2024. Washington, DC. December 2024
- <b><i>Li, G.</i></b> and Cao, G.: Neural process for uncertainty-aware geospatial modeling. ACM SIGSPATIAL 2024. Atlanta, GA. October 2024
- Cao, G. and <b><i>Li, G.</i></b>: Statistical Downscaling of Climate Datasets with Deep Generative Model and Bayesian inference. I-GUIDE Forum 2024. Jackson, WY. October 2024
- Cao, G. and <b><i>Li, G.</i></b>: Generative Adversarial Models for Extreme Downscaling of Geospatial Datasets. The 7th International Conference on Econometrics and Statistics (EcoSta 2024). Beijing Normal University, Beijing, China. July 2024
- Cao, G. and <b><i>Li, G.</i></b>: Generative Adversarial Models for Extreme Super-Resolution of Climate Datasets. Evaluating the Science of Geospatial AI. Harvard University, Cambridge, MA. May 2024
- <b><i>Li, G.</i></b> and Cao, G.: Bayesian Super-Resolution of Climate Datasets with Deep Generative Models. AAG 2024. Honolulu, HI. April 2024
- Cao, G. and <b><i>Li, G.</i></b>: Uncertainty Modeling in GeoAI. AAG 2024. Honolulu, HI. April 2024
- <b><i>Li, G.</i></b> and Cao, G.: Bayesian Super-Resolution of Geospatial Datasets with Deep Generative Models. Geospatial Knowledge Graphs and GeoAI Workshop, GIScience 2023. Leeds, UK. September 2023
- <b><i>Li, G.</i></b> and Cao, G.: Generative Adversarial Models for Extreme Super-Resolution of Climate Datasets. AAG 2023. Denver, CO. March 2023
- Cao, G. and <b><i>Li, G.</i></b>: A deep learning-based geostatistical framework for geospatial uncertainty modeling. AAG 2023. Denver, CO. March 2023

# 🎖 Honors and Awards
- *2026* & *2025* Jennifer Dinaburg Memorial Research Awards, Department of Geography, University of Colorado Boulder
- *2020* Top 10 Students, Hubei University
- *2019* & *2018* Scientific Research Scholarship, Hubei University

# 💰 Fellowships and Grants
- *2026* Graduate School Dissertation Completion Fellowship, University of Colorado Boulder
- *2026* & *2023* Graduate School Student Travel Grant, University of Colorado Boulder
- *2025* Geography Graduate Student Travel & Research Funds, Department of Geography, University of Colorado Boulder
- *2024* ACM SIGSPATIAL 2024 Travel Grant, National Science Foundation
- *2020* Distinguished Graduate Student Fellowship, Texas Tech University

# 🏆 Professional Services and Memberships

Journal Reviewer for:
- Geographical Analysis
- Journal of Geophysical Research: Machine Learning and Computation
- International journal of applied earth observation and geoinformation
- International Journal of Geographical Information Science

Professional Memberships:
- Association of American Geographers (AAG)
- Chinese Professionals in Geographic Information Science (CPGIS)
- ACM Special Interest Group on Spatial Information (SIGSPATIAL)

# 🧑‍💻 Technical Skills
- Programming: Python, MATLAB, R, JavaScript, SQL
- ML/DL Frameworks: PyTorch, TensorFlow, Scikit-learn
- GIS: ArcGIS, QGIS, Google Earth Engine, PostGIS
- Systems & Tools: HPC (SLURM), Linux, Docker, Git, LaTeX

<!-- # 💻 Internships
- *2019.05 - 2020.02*, [Lorem](https://github.com/), China. -->