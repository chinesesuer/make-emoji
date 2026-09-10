-- ============================================================
-- 表情包小程序 · 数据库设计（MySQL 8.0 / InnoDB / utf8mb4）
-- 设计要点：素材走数据库+对象存储，小程序不发版即可更新素材
-- ============================================================

-- 1. 素材分类表（对应小程序各 Tab 下的二级分类，如 选身体 下的 熊猫/蘑菇头/圆脸）
DROP TABLE IF EXISTS `emoji_category`;
CREATE TABLE `emoji_category` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scene`       ENUM('body','face','accessory','text','sticker') NOT NULL COMMENT '所属场景：body选身体/face选表情/accessory选挂件/text文字/sticker仓库',
  `name`        VARCHAR(32)  NOT NULL COMMENT '分类名，如 熊猫、蘑菇头',
  `cover_url`   VARCHAR(255) DEFAULT NULL COMMENT '分类图标',
  `sort`        INT NOT NULL DEFAULT 0 COMMENT '排序，越小越靠前',
  `status`      TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_scene_status` (`scene`,`status`,`sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='素材分类表';

-- 2. 素材模板表（身体 / 表情 / 挂件 三合一，用 scene 区分）
DROP TABLE IF EXISTS `emoji_material`;
CREATE TABLE `emoji_material` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scene`         ENUM('body','face','accessory') NOT NULL COMMENT '素材类型',
  `category_id`   BIGINT UNSIGNED NOT NULL COMMENT '所属分类',
  `name`          VARCHAR(64)  NOT NULL COMMENT '素材名，如 熊猫-招手',
  `file_url`      VARCHAR(255) NOT NULL COMMENT '对象存储地址（PNG透明底）',
  `thumb_url`     VARCHAR(255) DEFAULT NULL COMMENT '列表缩略图',
  `file_type`     ENUM('png','gif','webp','svg') NOT NULL DEFAULT 'png',
  `width`         INT DEFAULT 0,
  `height`        INT DEFAULT 0,
  `file_size`     INT DEFAULT 0 COMMENT '字节',
  `anchor_x`      DECIMAL(5,2) DEFAULT 50.00 COMMENT '默认锚点X百分比',
  `anchor_y`      DECIMAL(5,2) DEFAULT 50.00 COMMENT '默认锚点Y百分比',
  `default_scale` DECIMAL(4,2) DEFAULT 1.00 COMMENT '默认缩放',
  `sort`          INT NOT NULL DEFAULT 0,
  `status`        TINYINT NOT NULL DEFAULT 1 COMMENT '1上架 0下架',
  `use_count`     INT NOT NULL DEFAULT 0 COMMENT '被使用次数',
  `created_by`    BIGINT UNSIGNED DEFAULT NULL COMMENT '上传管理员ID',
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_scene_cat` (`scene`,`category_id`,`status`,`sort`),
  KEY `idx_use_count` (`use_count`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='素材模板表';

-- 3. 文字模板表（贴文字 Tab 的预设文案与样式）
DROP TABLE IF EXISTS `emoji_text_template`;
CREATE TABLE `emoji_text_template` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `content`    VARCHAR(64)  NOT NULL COMMENT '文案，如 哈哈哈哈哈',
  `style`      ENUM('stroke','solid','color') NOT NULL DEFAULT 'stroke' COMMENT 'stroke描边/solid黑底白字/color彩色',
  `font_name`  VARCHAR(32)  DEFAULT 'PingFangSC-Bold',
  `color`      VARCHAR(16)  DEFAULT '#000000',
  `bg_color`   VARCHAR(16)  DEFAULT NULL,
  `position`   ENUM('top','center','bottom') DEFAULT 'bottom',
  `sort`       INT NOT NULL DEFAULT 0,
  `status`     TINYINT NOT NULL DEFAULT 1,
  `use_count`  INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status_sort` (`status`,`sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文字模板表';

-- 4. 表情仓库表（成品表情，供用户直接保存/分享）
DROP TABLE IF EXISTS `sticker`;
CREATE TABLE `sticker` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`         VARCHAR(64)  NOT NULL,
  `cover_url`     VARCHAR(255) NOT NULL,
  `file_url`      VARCHAR(255) NOT NULL,
  `type`          ENUM('png','gif') NOT NULL DEFAULT 'png',
  `category_id`   BIGINT UNSIGNED DEFAULT NULL,
  `tags`          VARCHAR(255) DEFAULT NULL COMMENT '逗号分隔标签，用于搜索',
  `author_name`   VARCHAR(64)  DEFAULT '官方' COMMENT '无用户投稿，全部由运营上传',
  `use_count`     INT NOT NULL DEFAULT 0,
  `favorite_count` INT NOT NULL DEFAULT 0,
  `share_count`   INT NOT NULL DEFAULT 0,
  `is_hot`        TINYINT NOT NULL DEFAULT 0 COMMENT '是否上热榜',
  `is_recommend`  TINYINT NOT NULL DEFAULT 0,
  `sort`          INT NOT NULL DEFAULT 0,
  `status`        ENUM('online','offline') NOT NULL DEFAULT 'online' COMMENT '无用户投稿，不需要审核态',
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status_sort` (`status`,`sort`,`id`),
  KEY `idx_hot` (`is_hot`,`use_count`),
  FULLTEXT KEY `ft_title_tags` (`title`,`tags`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='表情仓库表';

-- 5. 工具配置表（GIF工具 / 更多工具 的宫格项，后台可控排序与开关）
DROP TABLE IF EXISTS `tool_config`;
CREATE TABLE `tool_config` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scene`      ENUM('gif','more') NOT NULL COMMENT 'gif=GIF工具Tab more=更多工具Tab',
  `group_name` VARCHAR(32)  DEFAULT NULL COMMENT '更多工具下的分组名，如 图片处理',
  `name`       VARCHAR(32)  NOT NULL COMMENT '视频转GIF',
  `code`       VARCHAR(32)  NOT NULL COMMENT 'video2gif，前端路由标识',
  `icon_url`   VARCHAR(255) DEFAULT NULL,
  `icon_class` VARCHAR(64)  DEFAULT NULL COMMENT '内置图标名（无图时使用）',
  `icon_color` VARCHAR(16)  DEFAULT '#5B5FE9',
  `jump_url`   VARCHAR(255) DEFAULT NULL COMMENT '原生页面路径',
  `is_new`     TINYINT NOT NULL DEFAULT 0,
  `is_hot`     TINYINT NOT NULL DEFAULT 0,
  `sort`       INT NOT NULL DEFAULT 0,
  `status`     TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`),
  KEY `idx_scene_sort` (`scene`,`status`,`sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='工具配置表';

-- 6. 用户作品表（仅用户自己可见的「我的制作」，无投稿/无审核）
DROP TABLE IF EXISTS `user_work`;
CREATE TABLE `user_work` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `title`       VARCHAR(64)  DEFAULT '我的表情',
  `file_url`    VARCHAR(255) NOT NULL COMMENT '保存到相册的作品（仅本人可见）',
  `thumb_url`   VARCHAR(255) DEFAULT NULL,
  `type`        ENUM('png','gif') NOT NULL DEFAULT 'png',
  `is_draft`    TINYINT NOT NULL DEFAULT 1 COMMENT '1草稿 0已完成',
  `layers`      JSON DEFAULT NULL COMMENT '图层数据：身体/表情/挂件/文字的坐标与缩放，用于再次编辑',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`,`is_draft`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户作品表（无审核态）';

-- 7. 素材包版本表（关键：小程序端缓存与增量更新）
DROP TABLE IF EXISTS `material_package_version`;
CREATE TABLE `material_package_version` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scene`       VARCHAR(16)  NOT NULL,
  `version`     INT NOT NULL COMMENT '递增版本号',
  `data_hash`   VARCHAR(64)  NOT NULL COMMENT '素材集合 MD5，用于判断是否需要拉取',
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scene` (`scene`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='素材版本号表（前端增量更新用）';

-- 8. 管理员与操作日志
DROP TABLE IF EXISTS `admin_user`;
CREATE TABLE `admin_user` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`   VARCHAR(32)  NOT NULL,
  `password`   VARCHAR(128) NOT NULL COMMENT 'bcrypt/argon2 哈希',
  `real_name`  VARCHAR(32)  DEFAULT NULL,
  `role`       ENUM('super','operator','auditor') NOT NULL DEFAULT 'operator',
  `status`     TINYINT NOT NULL DEFAULT 1,
  `last_login` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员表';

DROP TABLE IF EXISTS `admin_log`;
CREATE TABLE `admin_log` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`   BIGINT UNSIGNED NOT NULL,
  `module`     VARCHAR(32)  NOT NULL COMMENT 'material/sticker/tool/work',
  `action`     VARCHAR(32)  NOT NULL COMMENT 'create/update/delete/online/offline/audit',
  `target_id`  BIGINT UNSIGNED DEFAULT NULL,
  `detail`     VARCHAR(255) DEFAULT NULL,
  `ip`         VARCHAR(45)  DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_admin` (`admin_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员操作日志';

-- ============================================================
-- 初始化示例数据
-- ============================================================
INSERT INTO `emoji_category` (`scene`,`name`,`sort`) VALUES
 ('body','熊猫',1),('body','蘑菇头',2),('body','圆脸',3),('body','兔子',4),('body','黑暗势力',5),
 ('face','开心',1),('face','搞笑',2),('face','生气',3),('face','难过',4),
 ('accessory','头饰',1),('accessory','眼镜',2),('accessory','手持',3),('accessory','装饰',4),
 ('sticker','热门',1),('sticker','最新',2),('sticker','搞笑',3),('sticker','金句',4);

INSERT INTO `tool_config` (`scene`,`name`,`code`,`icon_class`,`icon_color`,`sort`) VALUES
 ('gif','视频转GIF','video2gif','fa-film','#5B5FE9',1),
 ('gif','多图转GIF','images2gif','fa-images','#5B5FE9',2),
 ('gif','GIF裁剪','gif_crop','fa-crop-simple','#5B5FE9',3),
 ('gif','GIF剪切','gif_cut','fa-scissors','#5B5FE9',4),
 ('gif','GIF变速','gif_speed','fa-gauge-high','#5B5FE9',5),
 ('gif','GIF加文字','gif_text','fa-pen','#5B5FE9',6),
 ('gif','GIF旋转','gif_rotate','fa-rotate-right','#5B5FE9',7),
 ('gif','GIF镜像','gif_mirror','fa-arrows-left-right','#5B5FE9',8),
 ('gif','GIF改大小','gif_resize','fa-expand','#5B5FE9',9),
 ('gif','GIF转视频','gif2video','fa-circle-play','#5B5FE9',10),
 ('gif','GIF帧转图片','gif_frames','fa-image','#5B5FE9',11);

INSERT INTO `emoji_text_template` (`content`,`style`,`position`,`sort`) VALUES
 ('哈哈哈哈哈','stroke','bottom',1),('无语','stroke','bottom',2),('尊嘟假嘟','stroke','bottom',3),
 ('蚌埠住了','stroke','bottom',4),('6','stroke','bottom',5),('芜湖起飞','stroke','bottom',6);
