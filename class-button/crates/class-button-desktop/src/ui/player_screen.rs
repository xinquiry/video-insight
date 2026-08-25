use makepad_widgets::*;

script_mod! {
    use mod.prelude.widgets.*
    use mod.widgets.*

    mod.widgets.PlayerScreen = ViPaper{
        width: Fill
        height: Fill
        flow: Down

        top_bar := ViSurface{
            width: Fill
            height: 76
            flow: Right
            spacing: 12
            padding: Inset{left: 20 right: 20 top: 12 bottom: 12}
            align: Align{y: 0.5}

            brand_mark := RoundedView{
                width: 4
                height: 30
                show_bg: true
                draw_bg.color: theme.vi_accent
                draw_bg.border_radius: 2.0
            }
            brand_copy := View{
                width: Fill
                height: Fit
                flow: Down
                spacing: 2
                title_label := ViDisplayTitle{text: "Video Insight"}
                classroom_label := ViMeta{text: "正在读取课堂配置…"}
            }
            hub_badge := ViBadge{
                hub_status := ViKicker{
                    text: "HUB · 正在查找"
                    draw_text.color: theme.vi_forest
                }
            }
            open_video_button := ViButtonPrimary{text: "打开课程包"}
            fullscreen_button := ViButtonSecondary{text: "全屏"}
        }

        top_rule := ViRule{}

        workspace := View{
            width: Fill
            height: Fill
            flow: Right

            stage := ViStage{
                width: Fill
                height: Fill
                flow: Overlay

                video := Video{
                    width: Fill
                    height: Fill
                    show_controls: true
                    is_looping: false
                }

                empty_state := SolidView{
                    width: Fill
                    height: Fill
                    flow: Down
                    spacing: 12
                    padding: 24
                    align: Center
                    show_bg: true
                    new_batch: true
                    draw_bg.color: theme.vi_stage

                    empty_mark := RoundedView{
                        width: 48
                        height: 4
                        show_bg: true
                        draw_bg.color: theme.vi_accent
                        draw_bg.border_radius: 2.0
                    }
                    Label{
                        text: "打开课程视频开始播放"
                        draw_text.color: theme.vi_stage_text
                        draw_text.text_style: theme.font_bold{font_size: 21.0}
                    }
                    Label{
                        text: "支持单文件 .vinsight 课程包，也兼容带批注侧车的本地视频"
                        draw_text.color: theme.vi_stage_muted
                        draw_text.text_style: theme.font_regular{font_size: 12.0}
                    }
                    open_empty_button := ViButtonPrimary{text: "选择文件"}
                    ViStageMeta{text: "也可以把文件拖到此窗口"}
                }

                annotation_layer := View{
                    width: Fill
                    height: Fill
                    padding: Inset{left: 24 right: 24 top: 24 bottom: 82}
                    align: Align{x: 0.0 y: 1.0}
                    annotation_card := RoundedView{
                        width: 540
                        height: 230
                        flow: Down
                        spacing: 8
                        padding: Inset{left: 16 right: 16 top: 14 bottom: 14}
                        visible: false
                        show_bg: true
                        new_batch: true
                        draw_bg +: {
                            color: #x111720f2
                            border_color: #xffffff26
                            border_size: 1.0
                            border_radius: 9.0
                        }
                        overlay_header := View{
                            width: Fill
                            height: Fit
                            flow: Right
                            annotation_meta := Label{
                                width: Fill
                                height: Fit
                                text: "批注"
                                draw_text.color: #xf4b39e
                                draw_text.text_style: theme.font_bold{font_size: 10.0}
                            }
                            Label{
                                text: "VIDEOINSIGHT"
                                draw_text.color: theme.vi_stage_muted
                                draw_text.text_style: theme.font_bold{font_size: 9.0}
                            }
                        }
                        overlay_annotation_content := AnnotationContent{
                            width: Fill
                            height: Fill
                            dark: true
                        }
                    }
                }

                annotation_timeline_layer := View{
                    width: Fill
                    height: Fill
                    padding: Inset{left: 24 right: 24 bottom: 58}
                    align: Align{x: 0.0 y: 1.0}
                    timeline_panel := RoundedView{
                        width: Fill
                        height: 34
                        padding: Inset{left: 12 right: 12 top: 3 bottom: 3}
                        show_bg: true
                        new_batch: true
                        draw_bg +: {
                            color: #x111720d9
                            border_color: #xffffff24
                            border_size: 1.0
                            border_radius: 9.0
                        }
                        annotation_timeline := AnnotationTimeline{}
                    }
                }

                student_overlay := SolidView{
                    width: Fill
                    height: Fill
                    flow: Down
                    spacing: 14
                    padding: 24
                    align: Center
                    visible: false
                    show_bg: true
                    new_batch: true
                    draw_bg.color: #x080b10e8
                    ViKicker{
                        text: "CLASS BUTTON · 学生请求暂停"
                        draw_text.color: #xf4b39e
                    }
                    student_name := Label{
                        text: ""
                        draw_text.color: theme.vi_stage_text
                        draw_text.text_style: theme.font_bold{font_size: 34.0}
                    }
                    student_seat := Label{
                        text: ""
                        draw_text.color: theme.vi_stage_muted
                        draw_text.text_style: theme.font_regular{font_size: 17.0}
                    }
                    handled_button := ViButtonPrimary{
                        text: "已处理"
                        width: 120
                    }
                }
            }

            sidebar := ViSurface{
                width: 408
                height: Fill
                flow: Down
                spacing: 12
                padding: Inset{left: 18 right: 18 top: 16 bottom: 16}

                sidebar_header := View{
                    width: Fill
                    height: Fit
                    flow: Down
                    spacing: 5
                    header_row := View{
                        width: Fill
                        height: Fit
                        flow: Right
                        align: Align{y: 0.5}
                        ViPanelTitle{
                            width: Fill
                            text: "播放批注"
                        }
                        count_badge := ViBadge{
                            annotation_count := ViKicker{
                                text: "0 条"
                                draw_text.color: theme.vi_accent
                            }
                        }
                    }
                    video_name := ViBody{
                        text: "尚未打开视频"
                        draw_text.text_style: theme.font_bold{font_size: 11.0}
                    }
                    annotation_source := ViMeta{
                        width: Fill
                        text: "打开课程包后会在这里显示批注来源"
                    }
                }

                ViRule{}

                current_header := View{
                    width: Fill
                    height: Fit
                    flow: Right
                    align: Align{y: 0.5}
                    ViKicker{width: Fill text: "当前批注"}
                    current_annotation_position := ViMeta{text: "— / 0"}
                }
                current_meta := View{
                    width: Fill
                    height: Fit
                    flow: Right
                    align: Align{y: 0.5}
                    current_annotation_meta := ViSectionTitle{
                        width: Fill
                        text: "等待播放"
                    }
                    current_annotation_kind := ViKicker{
                        text: "NOTE"
                        draw_text.color: theme.vi_accent
                    }
                }
                current_panel := ViPanelPaper{
                    width: Fill
                    height: Fill
                    flow: Down
                    annotation_content := AnnotationContent{
                        width: Fill
                        height: Fill
                    }
                }

                upcoming_header := View{
                    width: Fill
                    height: Fit
                    flow: Right
                    ViKicker{width: Fill text: "接下来"}
                    ViMeta{text: "时间轴"}
                }
                next_row_one := ViTimelineRow{
                    next_annotation_1_time := ViKicker{
                        width: 46
                        text: "—"
                        draw_text.color: theme.vi_accent
                    }
                    next_annotation_1 := ViBody{
                        text: "没有后续批注"
                        draw_text.text_style.font_size: 11.0
                    }
                }
                next_row_two := ViTimelineRow{
                    next_annotation_2_time := ViKicker{
                        width: 46
                        text: "—"
                        draw_text.color: theme.vi_accent
                    }
                    next_annotation_2 := ViBody{
                        text: "—"
                        draw_text.text_style.font_size: 11.0
                    }
                }

                navigation := View{
                    width: Fill
                    height: Fit
                    flow: Right
                    spacing: 10
                    previous_annotation_button := ViButtonSecondary{
                        text: "上一条"
                        width: Fill
                    }
                    next_annotation_button := ViButtonPrimary{
                        text: "下一条"
                        width: Fill
                    }
                }
                runtime_error := Label{
                    width: Fill
                    height: Fit
                    text: ""
                    draw_text.color: theme.vi_danger
                    draw_text.text_style: theme.font_regular{font_size: 9.0}
                }
            }
        }
    }
}
